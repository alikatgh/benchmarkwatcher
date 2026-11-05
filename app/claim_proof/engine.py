"""Bounded, deterministic financial calculations. No model or network dependencies."""

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, localcontext
from datetime import date
from urllib.parse import urlsplit


class CalculationError(ValueError):
    pass


@dataclass(frozen=True)
class Operand:
    id: str
    value: Decimal | None
    unit: str
    start: str
    end: str


def number(raw):
    if raw is None:
        raise CalculationError("A required operand is missing; it cannot be treated as zero.")
    if not isinstance(raw, (str, int, Decimal)) or isinstance(raw, bool):
        raise CalculationError("Operands must be finite decimal values.")
    if isinstance(raw, str) and len(raw) > 80:
        raise CalculationError("Operand is outside the supported finite range.")
    try:
        result = Decimal(raw)
    except (InvalidOperation, ValueError):
        raise CalculationError("Invalid decimal operand.") from None
    if not result.is_finite() or result.copy_abs() > Decimal("1e18"):
        raise CalculationError("Operand is outside the supported finite range.")
    return result


def validate_operands(*operands, same_period=True):
    if not operands or any(op is None for op in operands):
        raise CalculationError("A required operand is missing.")
    for op in operands:
        number(op.value)
        try:
            if date.fromisoformat(op.start) >= date.fromisoformat(op.end):
                raise ValueError
        except (ValueError, TypeError):
            raise CalculationError("Each operand needs valid start and end dates.") from None
    if any(op.unit != operands[0].unit for op in operands):
        raise CalculationError("Currency and scale must match across operands.")
    if operands[0].unit not in {"USD", "USD_millions"}:
        raise CalculationError("Unsupported currency or unit.")
    if same_period and any((op.start, op.end) != (operands[0].start, operands[0].end) for op in operands):
        raise CalculationError("Operand start and end dates must match.")


def change(start, end):
    validate_operands(start, end, same_period=False)
    with localcontext() as ctx:
        ctx.prec = 40
        delta = end.value - start.value
        growth = (end.value / start.value - 1) * 100 if start.value > 0 else None
    return delta, growth


def operating_margin(income, revenue):
    validate_operands(income, revenue)
    if revenue.value <= 0:
        raise CalculationError("Operating margin is unavailable: revenue must be a positive denominator.")
    with localcontext() as ctx:
        ctx.prec = 40
        return income.value / revenue.value * 100


def free_cash(cash_flow, cash_ppe):
    validate_operands(cash_flow, cash_ppe)
    with localcontext() as ctx:
        ctx.prec = 40
        return cash_flow.value - abs(cash_ppe.value)


def exact(value):
    return None if value is None else format(value, "f")


def display(value, unit, signed=False):
    if value is None:
        return "Unavailable"
    prefix = "+" if signed and value > 0 else ""
    if unit == "USD_millions":
        return f"{prefix}${value / 1000:,.2f}B"
    suffix = " pp" if unit == "percentage_points" else "%"
    return f"{prefix}{value:,.2f}{suffix}"


class ResearchEngine:
    def __init__(self, fixture):
        self.fixture = fixture
        self.periods = fixture["dataset"]["periods"]

    def fact(self, period, metric):
        key = f"{period}.{metric}"
        if period not in self.periods:
            raise CalculationError(f"{period} is outside this loaded dataset.")
        raw = self.fixture["facts"].get(key)
        if raw is None or raw.get("value") is None:
            raise CalculationError(f"Missing operand: {key}.")
        dates = self.periods[period]
        if raw.get("period") != period or dates.get("frequency") != "annual":
            raise CalculationError(f"Period mismatch for {key}.")
        source = self.fixture["sources"].get(raw.get("source_id"))
        identities = {
            "revenue": ("Total revenue", "Income Statements", "IS"),
            "operating_income": ("Operating income", "Income Statements", "IS"),
            "operating_cash_flow": ("Net cash from operations", "Cash Flows Statements", "CF"),
            "cash_ppe_signed": ("Additions to property and equipment", "Cash Flows Statements", "CF"),
        }
        if metric not in identities:
            raise CalculationError("Metric is outside the selected fact allowlist.")
        expected_row, expected_section, table = identities[metric]
        expected_source_id = f"S{period[-2:]}_{table}"
        if (not source or raw.get("source_id") != expected_source_id or raw.get("row") != expected_row
                or source.get("section") != expected_section or expected_row not in source.get("rows", [])
                or period not in source.get("columns", []) or raw.get("method") != "reported"):
            raise CalculationError(f"Source row or column does not support {key}.")
        parsed_url = urlsplit(source["url"])
        if (parsed_url.scheme != "https" or parsed_url.netloc != "www.microsoft.com"
                or parsed_url.path != f"/investor/reports/ar{period[-2:]}/index.html" or parsed_url.query or parsed_url.fragment):
            raise CalculationError("Source URL is outside the fixed research allowlist.")
        op = Operand(key, number(raw["value"]), raw["unit"], dates["start"], dates["end"])
        validate_operands(op)
        return op

    def evidence(self, operand):
        raw = self.fixture["facts"][operand.id]
        source = self.fixture["sources"][raw["source_id"]]
        return {
            "id": operand.id, "value": exact(operand.value), "unit": operand.unit,
            "normalized_usd": exact(operand.value * 1000000) if operand.unit == "USD_millions" else exact(operand.value),
            "start": operand.start, "end": operand.end, "row": raw["row"],
            "source_id": raw["source_id"], "document": source["document"],
            "section": source["section"], "url": source["url"],
            "accession": source["accession"], "filed": source["filed"], "method": "reported",
        }

    def execute(self, plan):
        # Revalidate at the execution boundary, including callers outside the web app.
        from planner import validate_plan
        plan = validate_plan(plan)
        periods = plan["periods"]
        operation = plan["operation"]
        facts = {}
        calculations = []

        def operand(period, metric):
            op = self.fact(period, metric)
            facts[op.id] = self.evidence(op)
            return op

        def add(key, label, value, unit, formula, ops, signed=False, note=""):
            calculations.append({"id": key, "label": label, "value": exact(value), "unit": unit,
                                 "display": display(value, unit, signed), "formula": formula,
                                 "operand_ids": list(dict.fromkeys(op.id for op in ops)),
                                 "method": "calculated", "note": note})

        title, summary, kind = "", "", "answer"
        if operation == "ai_allocation":
            op = operand(periods[0], "cash_ppe_signed")
            add("cash_ppe_aggregate", "Cash additions to property and equipment", abs(op.value),
                op.unit, f"abs({op.id})", [op], note="Consolidated cash PP&E additions; this is not an AI-only measure.")
            title, kind = "The AI-only amount is not supported", "abstain_partial"
            summary = ("The selected consolidated cash-flow rows do not identify an AI-only allocation. "
                       "The supported aggregate is shown below. An AI-specific amount needs additional source evidence.")
        elif operation == "revenue" and len(periods) == 1:
            op = operand(periods[0], "revenue")
            add("revenue", f"{periods[0]} revenue", op.value, op.unit, op.id, [op],
                note="Reported revenue, displayed in USD billions; the exact statement value remains below.")
            title, summary = "Revenue, with the original row", "The display is converted once from the statement’s USD millions."
        elif operation in {"comparison", "revenue", "margin"}:
            title = "Revenue and operating margin" if operation == "comparison" else ("Revenue comparison" if operation == "revenue" else "Operating margin comparison")
            summary = "The comparison follows your start and end periods. Margin changes use percentage points."
            revenues = [operand(p, "revenue") for p in periods]
            if operation in {"comparison", "revenue"}:
                for p, op in zip(periods, revenues):
                    add(f"revenue_{p}", f"{p} revenue", op.value, op.unit, op.id, [op])
                delta, growth = change(*revenues)
                add("revenue_delta", "Revenue change", delta, "USD_millions", f"{revenues[1].id} − {revenues[0].id}", revenues, True)
                add("revenue_growth", "Revenue growth", growth, "percent", f"({revenues[1].id} / {revenues[0].id} − 1) × 100", revenues, True,
                    "Relative growth requires a positive starting value." if growth is None else "")
            if operation in {"comparison", "margin"}:
                margins, ops = [], []
                for p, revenue in zip(periods, revenues):
                    income = operand(p, "operating_income")
                    value = operating_margin(income, revenue)
                    margins.append(value)
                    ops.extend([income, revenue])
                    add(f"margin_{p}", f"{p} operating margin", value, "percent", f"{income.id} / {revenue.id} × 100", [income, revenue])
                if len(periods) == 2:
                    with localcontext() as ctx:
                        ctx.prec = 40
                        margin_delta = margins[1] - margins[0]
                    add("margin_change", "Operating margin change", margin_delta, "percentage_points", f"margin_{periods[1]} − margin_{periods[0]}", ops, True)
        elif operation == "cash_flow":
            title = "Free cash flow did not keep pace" if periods == ["FY2024", "FY2025"] else "Free cash flow comparison"
            summary = ("Calculated FCF means operating cash flow minus absolute cash additions to property and equipment. "
                       "The cash bridge reconciles the change; it does not establish a business cause or an AI allocation.")
            cfo, ppe, fcf = [], [], []
            for p in periods:
                flow, spending = operand(p, "operating_cash_flow"), operand(p, "cash_ppe_signed")
                value = free_cash(flow, spending)
                cfo.append(flow)
                ppe.append(spending)
                fcf.append(Operand(f"fcf_{p}", value, flow.unit, flow.start, flow.end))
                add(f"fcf_{p}", f"{p} calculated FCF", value, flow.unit, f"{flow.id} − abs({spending.id})", [flow, spending])
            delta, growth = change(*fcf)
            all_ops = [cfo[0], ppe[0], cfo[1], ppe[1]]
            add("fcf_delta", "Calculated FCF change", delta, "USD_millions", f"fcf_{periods[1]} − fcf_{periods[0]}", all_ops, True)
            add("fcf_growth", "Calculated FCF growth", growth, "percent", f"(fcf_{periods[1]} / fcf_{periods[0]} − 1) × 100", all_ops, True,
                "Relative growth requires a positive starting value." if growth is None else "")
            cfo_delta, _ = change(*cfo)
            validate_operands(*ppe, same_period=False)
            ppe_delta = abs(ppe[1].value) - abs(ppe[0].value)
            add("cash_flow_delta", "Operating cash flow change", cfo_delta, "USD_millions", f"{cfo[1].id} − {cfo[0].id}", cfo, True)
            add("cash_ppe_delta", "Cash PP&E additions change", ppe_delta, "USD_millions", f"abs({ppe[1].id}) − abs({ppe[0].id})", ppe, True)
            if cfo_delta - ppe_delta != delta:
                raise CalculationError("Cash bridge does not reconcile.")
            add("cash_bridge", "Cash bridge", delta, "USD_millions", "cash_flow_delta − cash_ppe_delta = fcf_delta", all_ops, True,
                f"{exact(cfo_delta)} − {exact(ppe_delta)} = {exact(delta)} (USD millions)")
        return {"kind": kind, "title": title, "summary": summary,
                "company": "MSFT", "periods": periods,
                "period_details": [{"id": p, **self.periods[p]} for p in periods],
                "calculations": calculations, "facts": list(facts.values()), "plan": plan}
