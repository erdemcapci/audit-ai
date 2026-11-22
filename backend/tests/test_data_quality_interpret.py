from __future__ import annotations

import asyncio
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings
from app.features.data_quality import interpret
from app.features.data_quality.interpret import data_quality_interpretation_service, results_summary, unverified
from app.features.data_quality.models import DataQualityRunCreate, RunTotals, SourceFile
from app.features.data_quality.store import data_quality_store
from app.llm.base import LLMResponse
from app.models import AuditCreate
from app.services.agent_run_log_service import agent_run_log_service
from app.store.file_store import FileStore
from app.store.project_store import project_store


def card(test_id: str, subject: str, exceptions: int, tested: int, severity: str, summary: str, classification: str | None = None) -> dict:
    result = {"testId": test_id, "subject": subject, "tested": tested, "exceptions": exceptions, "rate": exceptions / tested * 100,
              "severity": severity, "summary": summary, "examples": [{"row": 2, "value": "INV-1", "reason": "Appears 2 times"}]}
    if classification:
        result["classification"] = classification
    return result


def run_payload() -> DataQualityRunCreate:
    return DataQualityRunCreate(
        source=SourceFile(name="invoices.csv", rows=25020, columns=3, headers=["invoice_number", "amount", "notes"]),
        totals=RunTotals(tests=5, findings=2, high=1, low=1, exceptions=110),
        verdict="significant_issues",
        profile={"rows": 25020, "columns": [{"name": "invoice_number", "type": "identifier", "blankPercent": 0}, {"name": "amount", "type": "measure", "blankPercent": 0.04}]},
        results=[
            {"template": "uniqueness.key", "title": "Duplicate keys", "status": "done", "cards": [card("uniqueness.key:invoice_number", "invoice_number", 98, 25012, "high", "49 values appear more than once, in 98 records (0.39%).")]},
            {"template": "completeness.blank", "title": "Blank values", "status": "done", "cards": [card("completeness.blank:amount", "amount", 12, 25020, "low", "12 of 25,020 values are blank (0.05%)."), card("completeness.blank:invoice_number", "invoice_number", 0, 25020, "clean", "No blank values.")]},
            {"template": "rule", "title": "Dataset rules", "status": "done", "cards": [card("rule:a → b", "a → b", 9000, 25000, "low", "The rule does not hold.", "rule_did_not_hold")]},
            {"template": "accuracy.calendar", "title": "Weekend dates", "status": "not_applicable", "cards": []},
        ],
    )


class FakeProvider:
    def __init__(self, *answers: dict):
        self.answers = list(answers)
        self.prompts: list[str] = []

    async def generate(self, system_prompt: str, user_prompt: str, json_mode: bool = True) -> LLMResponse:
        self.prompts.append(user_prompt)
        return LLMResponse(content=json.dumps(self.answers.pop(0)), provider="fake", model="fake-1")


def answer(summary: str) -> dict:
    return {
        "verdict": "usable_with_conditions",
        "summary": summary,
        "cards": [
            {"card_id": "uniqueness.key:invoice_number", "severity": "high", "severity_reason": "98 invoices share a number.", "meaning": "m", "action": "investigate_in_fieldwork", "action_text": "Select them."},
            {"card_id": "completeness.blank:amount", "severity": "urgent", "action": "fly", "meaning": "Blank amounts."},
            {"card_id": "made-up", "severity": "low"},
        ],
        "client_questions": ["Why do 98 invoices share a number?", 42],
        "limitations": ["Weekend dates could not be tested."],
    }


class DataQualityInterpretationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original = {"projects_dir": settings.projects_dir, "demo_mode": settings.demo_mode, "agent_run_logs_enabled": settings.agent_run_logs_enabled}
        self.original_file_store = project_store.file_store
        settings.projects_dir = Path(self.temp_dir.name)
        settings.agent_run_logs_enabled = True
        project_store.file_store = FileStore(settings.projects_dir)
        self.project = project_store.create_project(AuditCreate(title="Procurement", description="Invoices"))
        self.run = data_quality_store.create_run(self.project.id, run_payload())

    def tearDown(self) -> None:
        project_store.file_store = self.original_file_store
        for key, value in self.original.items():
            setattr(settings, key, value)
        self.temp_dir.cleanup()

    def interpret(self):
        return asyncio.run(data_quality_interpretation_service.interpret(self.project.id, self.run.id, "local"))

    def test_the_ai_sees_findings_and_counts_but_not_passed_cards(self) -> None:
        results = results_summary(self.run)
        self.assertEqual([c["card_id"] for c in results["cards"]], ["uniqueness.key:invoice_number", "completeness.blank:amount", "rule:a → b"])
        self.assertEqual(results["cards"][2]["classification"], "rule_did_not_hold")
        self.assertEqual(results["passed"], ["Blank values: 1 passed"])
        self.assertEqual(results["not_tested"], ["Weekend dates (not applicable)"])

    def test_demo_interpretation_is_saved_with_the_run(self) -> None:
        settings.demo_mode = True
        run = self.interpret()

        ai = run.ai_interpretation
        self.assertEqual((ai["verdict"], ai["demo"], run.ai_verdict, run.ai_used), ("usable_with_conditions", True, "usable_with_conditions", True))
        self.assertEqual(len(ai["cards"]), 3)
        self.assertEqual(ai["cards"][0]["action"], "investigate_in_fieldwork")
        self.assertEqual(ai["cards"][2]["action"], "ask_client", "a rule that did not hold is a question for the client")
        self.assertTrue(all(not c["unverified_numbers"] for c in ai["cards"]))
        self.assertEqual(ai["limitations"], ["Weekend dates (not applicable) could not be tested."])
        self.assertEqual(data_quality_store.list_runs(self.project.id)[0].ai_verdict, "usable_with_conditions")
        self.assertEqual(agent_run_log_service.get_run(self.project.id, ai["log_run_id"]).agent_name, "Data quality: AI interpretation")

    def test_model_answer_is_normalised_to_the_run(self) -> None:
        settings.demo_mode = False
        fake = FakeProvider(answer("The file can be used once 98 duplicate invoice numbers are explained."))
        with mock.patch.object(interpret, "get_llm_provider", return_value=fake):
            ai = self.interpret().ai_interpretation

        self.assertEqual([c["card_id"] for c in ai["cards"]], ["uniqueness.key:invoice_number", "completeness.blank:amount"])
        blank = ai["cards"][1]
        self.assertEqual((blank["severity"], blank["action"]), ("low", "no_action"), "invalid values fall back to safe defaults")
        self.assertEqual(ai["client_questions"], ["Why do 98 invoices share a number?"])
        self.assertEqual((ai["attempts"], ai["unverified_numbers"]), (1, []))
        self.assertIn("Do not round them differently", fake.prompts[0])

    def test_invented_numbers_trigger_one_retry_and_are_flagged_if_they_stay(self) -> None:
        settings.demo_mode = False
        fake = FakeProvider(answer("About 120 invoices are duplicated."), answer("Still 777 problems."))
        with mock.patch.object(interpret, "get_llm_provider", return_value=fake):
            ai = self.interpret().ai_interpretation

        self.assertEqual(ai["attempts"], 2)
        self.assertIn("120", fake.prompts[1], "the retry names the wrong number")
        self.assertEqual(ai["unverified_numbers"], ["777"])

    def test_numbers_are_matched_with_rounding_tolerance(self) -> None:
        allowed = [98.0, 0.39, 25012.0]
        self.assertEqual(unverified("98 records, 0.4%, 25,012 rows, 3 days", allowed), [])
        self.assertEqual(unverified("about 500 rows", allowed), ["500"])

    def test_a_failed_model_call_leaves_the_run_unchanged(self) -> None:
        settings.demo_mode = False

        class Broken:
            async def generate(self, *args, **kwargs):
                raise RuntimeError("provider down")

        with mock.patch.object(interpret, "get_llm_provider", return_value=Broken()):
            with self.assertRaises(RuntimeError):
                self.interpret()
        self.assertIsNone(data_quality_store.get_run(self.project.id, self.run.id).ai_interpretation)
        self.assertEqual(agent_run_log_service.list_runs(self.project.id)[0].status, "error")


if __name__ == "__main__":
    unittest.main()
