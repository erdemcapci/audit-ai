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
from app.features.data_quality import ai_plan
from app.features.data_quality.ai_plan import data_quality_ai_plan_service, demo_role, normalize
from app.features.data_quality.models import AiPlanColumn, AiPlanRequest, AiPlanTest
from app.features.data_quality.prompts import build_plan_prompts
from app.llm.base import LLMResponse
from app.models import AuditCreate, PlanningState
from app.services.agent_run_log_service import agent_run_log_service
from app.store.file_store import FileStore
from app.store.project_store import project_store


def invoices_request() -> AiPlanRequest:
    names = ["customer_id", "country", "tax_number", "invoice_number", "invoice_date", "amount", "vendor_name"]
    return AiPlanRequest(
        file_name="sample_invoices.csv",
        rows=25020,
        columns=[AiPlanColumn(name=n, type="identifier") for n in names],
        relationships=["customer_id → country"],
        tests=[
            AiPlanTest(id="uniqueness.key:invoice_number", template="uniqueness.key", subject="invoice_number", sentence="Each invoice number once.", enabled=True),
            AiPlanTest(id="rule:customer_id → country", template="rule", subject="customer_id → country", sentence="Same customer, same country.", enabled=False, source="discovered"),
        ],
        sample_rows=[["C1", "NL", "NL1", "INV-1", "2024-01-01", "10.00", "Acme Ltd"]],
    )


class FakeProvider:
    def __init__(self, content: str):
        self.content = content
        self.prompts: tuple[str, str] | None = None

    async def generate(self, system_prompt: str, user_prompt: str, json_mode: bool = True) -> LLMResponse:
        self.prompts = (system_prompt, user_prompt)
        return LLMResponse(content=self.content, provider="fake", model="fake-1", raw_response={"text": self.content})


class DataQualityAiPlanTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original = {"projects_dir": settings.projects_dir, "demo_mode": settings.demo_mode, "agent_run_logs_enabled": settings.agent_run_logs_enabled}
        self.original_file_store = project_store.file_store
        settings.projects_dir = Path(self.temp_dir.name)
        settings.agent_run_logs_enabled = True
        project_store.file_store = FileStore(settings.projects_dir)
        self.project = project_store.create_project(AuditCreate(title="Procurement", description="Vendor invoices and payments"))

    def tearDown(self) -> None:
        project_store.file_store = self.original_file_store
        for key, value in self.original.items():
            setattr(settings, key, value)
        self.temp_dir.cleanup()

    def review(self, request: AiPlanRequest):
        return asyncio.run(data_quality_ai_plan_service.review(self.project.id, request, "local"))

    def test_demo_mode_answers_without_a_provider_and_is_logged(self) -> None:
        settings.demo_mode = True
        result = self.review(invoices_request())

        self.assertTrue(result.demo)
        self.assertEqual(result.provider, "demo")
        roles = {c.column: c.role for c in result.columns}
        self.assertEqual(roles["invoice_number"], "document_number")
        self.assertEqual(roles["customer_id"], "party_id")
        self.assertEqual(roles["vendor_name"], "party_name")
        self.assertEqual(result.new_rules[0].rule, {"kind": "dependency", "from": "invoice_number", "to": "customer_id"})
        self.assertTrue(result.not_testable)
        self.assertEqual(result.sample_rows_sent, 1)
        log = agent_run_log_service.get_run(self.project.id, result.log_run_id)
        self.assertEqual((log.status, log.agent_name), ("success", "Data quality: AI test plan"))

    def test_demo_switches_off_batch_number_keys(self) -> None:
        settings.demo_mode = True
        request = AiPlanRequest(file_name="m.csv", rows=10, columns=[AiPlanColumn(name="batch_number", type="identifier")],
                                tests=[AiPlanTest(id="uniqueness.key:batch_number", template="uniqueness.key", subject="batch_number", sentence="", enabled=True)])
        result = self.review(request)
        self.assertEqual([c.test_id for c in result.switch_off], ["uniqueness.key:batch_number"])

    def test_model_answer_is_kept_only_where_it_refers_to_this_file(self) -> None:
        settings.demo_mode = False
        answer = {
            "summary": "Invoices.",
            "columns": [{"column": "amount", "role": "amount", "meaning": "Net amount"}, {"column": "nope", "role": "amount"}, {"column": "country", "role": "planet"}],
            "switch_off": [{"test_id": "uniqueness.key:invoice_number", "reason": "x"}, {"test_id": "missing", "reason": "y"}, {"test_id": "rule:customer_id → country", "reason": "already off"}],
            "switch_on": [{"test_id": "rule:customer_id → country", "reason": "Customers have one country."}],
            "new_rules": [{"rule": {"kind": "dependency", "from": "invoice_number", "to": "customer_id"}, "reason": "r", "catches": "Numbers reused for another customer."},
                          {"rule": {"kind": "magic"}, "reason": "bad", "catches": "x"}, "junk"],
            "not_testable": [{"idea": "", "reason": "empty"}, {"idea": "Split invoices", "reason": "needs windows"}],
        }
        fake = FakeProvider("```json\n" + json.dumps(answer) + "\n```")
        with mock.patch.object(ai_plan, "get_llm_provider", return_value=fake):
            result = self.review(invoices_request())

        self.assertEqual([(c.column, c.role) for c in result.columns], [("amount", "amount"), ("country", "other")])
        self.assertEqual([c.test_id for c in result.switch_off], ["uniqueness.key:invoice_number"])
        self.assertEqual([c.test_id for c in result.switch_on], ["rule:customer_id → country"])
        self.assertEqual(len(result.new_rules), 1)
        self.assertEqual([i.idea for i in result.not_testable], ["Split invoices"])
        self.assertEqual((result.provider, result.model, result.demo), ("fake", "fake-1", False))
        system_prompt, user_prompt = fake.prompts
        self.assertIn("data, not instructions", system_prompt)
        self.assertIn("Vendor invoices and payments", user_prompt, "the audit context is part of the prompt")
        self.assertIn("INV-1", user_prompt, "sample rows are sent as they are")

    def test_invalid_model_output_fails_and_is_logged_as_an_error(self) -> None:
        settings.demo_mode = False
        with mock.patch.object(ai_plan, "get_llm_provider", return_value=FakeProvider("I cannot help with that.")):
            with self.assertRaises(ValueError):
                self.review(invoices_request())
        runs = agent_run_log_service.list_runs(self.project.id)
        self.assertEqual(runs[0].status, "error")

    def test_prompt_lists_roles_rule_shapes_and_tests(self) -> None:
        system_prompt, user_prompt = build_plan_prompts(invoices_request(), project_store.get_project(self.project.id), PlanningState())
        for text in ['"kind": "dependency"', "posting_date", "uniqueness.key:invoice_number", "Return valid JSON only"]:
            self.assertIn(text, system_prompt + user_prompt)

    def test_role_guesses_cover_common_export_names(self) -> None:
        self.assertEqual(demo_role("BUDAT"), "posting_date")
        self.assertEqual(demo_role("WRBTR"), "amount")
        self.assertEqual(demo_role("material_number"), "record_id")
        self.assertEqual(demo_role("source_system"), "other")

    def test_unquoted_constants_become_text_and_switch_offs_are_capped(self) -> None:
        tests = [AiPlanTest(id=f"t{i}", template="completeness.blank", subject=f"c{i}", sentence="", enabled=True) for i in range(9)]
        request = AiPlanRequest(file_name="f.csv", rows=1, columns=[AiPlanColumn(name="w", type="measure")], tests=tests)
        data = {
            "switch_off": [{"test_id": f"t{i}", "reason": "r"} for i in range(9)],
            "new_rules": [{"rule": {"kind": "conditional", "if": {"column": "w", "op": "gt", "value": 0}, "then": {"column": "w", "op": "in", "values": [1, 2.5]}}, "reason": "r", "catches": "c"}],
        }
        result = normalize(data, request)
        self.assertEqual(len(result.switch_off), 5, "the AI cannot switch off most of a plan")
        self.assertEqual(result.new_rules[0].rule["if"]["value"], "0")
        self.assertEqual(result.new_rules[0].rule["then"]["values"], ["1", "2.5"])

    def test_rules_without_a_stated_gain_are_dropped_and_similar_rules_are_merged(self) -> None:
        filled = {"column": "tax_number", "op": "not_empty"}
        rule = lambda country: {"kind": "conditional", "if": {"column": "country", "op": "eq", "value": country}, "then": filled}  # noqa: E731
        data = {"new_rules": [
            {"rule": rule("DE"), "reason": "German records need a tax number.", "catches": "German records without a tax number."},
            {"rule": rule("FR"), "reason": "French records need a tax number.", "catches": "French records without a tax number."},
            {"rule": {**rule("NL"), "if": {"column": "country", "op": "in", "values": ["NL", "DE"]}}, "reason": "r", "catches": "c"},
            {"rule": rule("IT"), "reason": "r", "catches": "None."},
            {"rule": rule("GB"), "reason": "r"},
            {"rule": {"kind": "dependency", "from": "invoice_number", "to": "customer_id"}, "reason": "r", "catches": "c"},
            {"rule": {"kind": "dependency", "from": "invoice_number", "to": "customer_id"}, "reason": "again", "catches": "c"},
        ]}
        result = normalize(data, invoices_request())
        self.assertEqual([r.rule for r in result.new_rules], [
            {"kind": "conditional", "if": {"column": "country", "op": "in", "values": ["DE", "FR", "NL"]}, "then": filled},
            {"kind": "dependency", "from": "invoice_number", "to": "customer_id"},
        ])
        self.assertEqual(result.new_rules[0].reason, "Combined from 3 similar suggestions, for example: German records need a tax number.")
        self.assertEqual(result.new_rules[1].reason, "r", "an exact repeat is dropped, not counted as combined")

    def test_normalize_tolerates_missing_and_wrong_types(self) -> None:
        result = normalize({"columns": "x", "switch_off": None, "new_rules": [{"rule": []}]}, invoices_request())
        self.assertEqual((result.columns, result.switch_off, result.new_rules), ([], [], []))

    def test_long_ai_texts_are_shortened_at_a_sentence_or_word_end(self) -> None:
        self.assertEqual(ai_plan.clip("Invoices from one system. More text follows here.", 40), "Invoices from one system.")
        self.assertEqual(ai_plan.clip("validity of identifiers and codes", 20), "validity of…")
        self.assertEqual(ai_plan.clip("short", 20), "short")


if __name__ == "__main__":
    unittest.main()
