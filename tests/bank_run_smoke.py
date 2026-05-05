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


def student_total(player_state: dict) -> int:
    return sum(int(item["payoff"]) for item in player_state["history"])


def join_students(browser, base_url: str, count: int):
    pages = []
    for index in range(count):
        page = browser.new_page()
        page.goto(f"{base_url}/bank-run.html?role=student", wait_until="networkidle")
        page.locator("#nameInput").fill(f"S{index + 1}")
        page.locator("#joinForm button").click()
        page.wait_for_load_state("networkidle")
        page.locator("#studentWorkspace").wait_for(state="visible")
        signal_text = page.locator("#studentSignalText").inner_text()
        assert signal_text.strip(), f"Student {index + 1} should receive a private signal."
        pages.append(page)
    return pages


def choose_student_action(page, action: str):
    page.locator(f"button[data-choice='{action}']").click()
    page.locator("#submitForm button[type='submit']").click()
    page.wait_for_timeout(150)


def run_survival_scenario(browser, base_url: str):
    teacher = browser.new_page()
    teacher.goto(f"{base_url}/bank-run.html?role=teacher", wait_until="networkidle")
    teacher.locator("#configForm button[type='submit']").click()
    teacher.wait_for_timeout(250)

    students = join_students(browser, base_url, 6)

    teacher.locator("#startDayButton").click()
    teacher.wait_for_timeout(250)
    choose_student_action(students[0], "withdraw")
    for page in students[1:]:
        choose_student_action(page, "wait")
    teacher.locator("#closeDayButton").click()
    teacher.wait_for_timeout(350)

    teacher.locator("#startDayButton").click()
    teacher.wait_for_timeout(250)
    choose_student_action(students[1], "withdraw")
    for page in students[2:5]:
        choose_student_action(page, "wait")
    teacher.locator("#closeDayButton").click()
    teacher.wait_for_timeout(350)

    teacher.locator("#startDayButton").click()
    teacher.wait_for_timeout(250)
    for page in students[2:]:
        choose_student_action(page, "wait")
    teacher.locator("#closeDayButton").click()
    teacher.wait_for_timeout(500)

    state = fetch_json(base_url, "/api/bank-run/teacher/state")
    assert state["status"] == "finished", state
    assert state["bankOutcome"] == "matured", state
    assert state["successfulWithdrawals"] == 2, state

    totals = []
    for page in students:
        token = page.evaluate("window.localStorage.getItem('bank-run-student-token')")
        player_state = fetch_json(base_url, f"/api/bank-run/student/state?token={token}")
        totals.append(student_total(player_state))

    assert totals[0] == 100, totals
    assert totals[1] == 100, totals
    assert totals[2:] == [150, 150, 150, 150], totals

    for page in students:
        page.close()
    teacher.close()


def run_collapse_scenario(browser, base_url: str):
    teacher = browser.new_page()
    teacher.goto(f"{base_url}/bank-run.html?role=teacher", wait_until="networkidle")
    teacher.locator("#resetButton").click()
    teacher.wait_for_timeout(250)
    teacher.locator("#configForm button[type='submit']").click()
    teacher.wait_for_timeout(250)

    students = join_students(browser, base_url, 6)

    teacher.locator("#startDayButton").click()
    teacher.wait_for_timeout(250)
    choose_student_action(students[0], "withdraw")
    choose_student_action(students[1], "withdraw")
    for page in students[2:]:
        choose_student_action(page, "wait")
    teacher.locator("#closeDayButton").click()
    teacher.wait_for_timeout(350)

    teacher.locator("#startDayButton").click()
    teacher.wait_for_timeout(250)
    choose_student_action(students[2], "withdraw")
    choose_student_action(students[3], "withdraw")
    choose_student_action(students[4], "wait")
    teacher.locator("#closeDayButton").click()
    teacher.wait_for_timeout(500)

    state = fetch_json(base_url, "/api/bank-run/teacher/state")
    assert state["status"] == "failed", state
    assert state["bankOutcome"] == "collapsed", state
    assert state["successfulWithdrawals"] == 3, state

    totals = []
    for page in students:
        token = page.evaluate("window.localStorage.getItem('bank-run-student-token')")
        player_state = fetch_json(base_url, f"/api/bank-run/student/state?token={token}")
        totals.append(student_total(player_state))

    assert totals[0] == 100, totals
    assert totals[1] == 100, totals
    assert sum(1 for value in totals[2:4] if value == 100) == 1, totals
    assert sum(1 for value in totals[2:4] if value == 0) == 1, totals
    assert totals[4] == 0, totals
    assert totals[5] == 0, totals

    for page in students:
        page.close()
    teacher.close()


def main():
    base_url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3000"

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            run_survival_scenario(browser, base_url)
            run_collapse_scenario(browser, base_url)
            print("bank-run-smoke-test: ok")
        finally:
            browser.close()


if __name__ == "__main__":
    main()
