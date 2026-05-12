import json
import sys
import urllib.request
from urllib.parse import urljoin

from playwright.sync_api import sync_playwright


def fetch_json(base_url: str, path: str) -> dict:
    with urllib.request.urlopen(urljoin(base_url, path)) as response:
        return json.loads(response.read().decode("utf-8"))


def post_json(base_url: str, path: str, payload: dict) -> dict:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        urljoin(base_url, path),
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read().decode("utf-8"))


def player_signal(page) -> str:
    page.wait_for_function(
        """() => {
            const node = document.querySelector('#studentSignalText');
            return node && node.textContent && node.textContent.trim() !== '--';
        }""",
        timeout=5000,
    )
    text = page.locator("#studentSignalText").inner_text().lower()
    if "positive" in text:
        return "positive"
    if "negative" in text:
        return "negative"
    raise AssertionError(f"Unknown signal text: {text}")


def signal_matching_guess(signal: str) -> str:
    return "viral" if signal == "positive" else "not_viral"


def submit_guess(page, guess: str):
    page.locator(f"button[data-choice='{guess}']").click()
    page.locator("#submitForm button[type='submit']").click()
    page.wait_for_timeout(200)


def join_students(browser, base_url: str, count: int):
    pages = []
    for index in range(count):
        page = browser.new_page()
        page.goto(f"{base_url}/herding.html?role=student", wait_until="networkidle")
        page.locator("#nameInput").fill(f"H{index + 1}")
        page.locator("#joinForm button").click()
        page.locator("#studentWorkspace").wait_for(state="visible")
        pages.append(page)
    return pages


def main():
    base_url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000"

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            post_json(base_url, "/api/herding/teacher/reset", {})
            teacher = browser.new_page()
            teacher.goto(f"{base_url}/herding.html?role=teacher", wait_until="networkidle")
            teacher.locator("#maxRoundsInput").fill("1")
            teacher.locator("#configForm button[type='submit']").click()
            teacher.wait_for_timeout(250)

            students = join_students(browser, base_url, 6)

            teacher.locator("#startRoundButton").click()
            teacher.wait_for_timeout(300)

            planned_choices = {}
            round_state = fetch_json(base_url, "/api/herding/teacher/state")
            order = round_state["currentRoundSummary"]["order"]
            assert len(order) == 6, round_state

            first_choice = None
            for turn_index, seat in enumerate(order):
                current_page = students[seat - 1]
                current_page.locator("#submitForm").wait_for(state="visible")
                signal = player_signal(current_page)
                guess = signal_matching_guess(signal)
                if turn_index in (1, 2) and first_choice is not None:
                    guess = first_choice
                if turn_index == 0:
                    first_choice = guess
                planned_choices[seat] = guess
                submit_guess(current_page, guess)

            teacher.wait_for_timeout(600)
            final_state = fetch_json(base_url, "/api/herding/teacher/state")
            assert final_state["status"] == "finished", final_state
            assert final_state["currentRoundSummary"]["status"] == "closed", final_state
            assert len(final_state["currentRoundSummary"]["resolvedChoices"]) == 6, final_state

            actual_state = final_state["currentRoundSummary"]["actualStateReveal"]
            reward = final_state["settings"]["correctReward"]
            expected_scores = {
                seat: reward if guess == actual_state else 0
                for seat, guess in planned_choices.items()
            }

            for seat, page in enumerate(students, start=1):
                token = page.evaluate("window.localStorage.getItem('herding-student-token')")
                player_state = fetch_json(
                    base_url, f"/api/herding/student/state?token={token}"
                )
                assert player_state["player"]["cumulative"] == expected_scores[seat], player_state
                assert len(player_state["player"]["history"]) == 1, player_state
                assert (
                    player_state["player"]["history"][0]["guess"] == planned_choices[seat]
                ), player_state

            for page in students:
                page.close()
            teacher.close()
            print("herding-smoke-test: ok")
        finally:
            browser.close()


if __name__ == "__main__":
    main()
