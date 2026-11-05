"""Pure historical claim tests and explicitly hypothetical PP&E sensitivity.

Every company is tested against its own FY2024/FY2025 fiscal dates. Different
companies' fiscal years are never represented as matching calendar intervals.
The source boundary belongs to FilingEngine; no model, network, forecast, or
causal explanation supplies quantities or decides whether a claim holds.
"""

from copy import deepcopy
from decimal import Decimal, localcontext
import re

from .engine import CalculationError, exact, free_cash, number, validate_operands
from .filings import COMPANIES, DEFAULT_COMPANIES, DEFAULT_MEASUREMENT_NOTE, FilingEngine, TAGS, select_companies


PERIODS = ("FY2024", "FY2025")
CLAIMS = {
    "cash_keeps_pace": "Free cash flow growth kept pace with revenue growth",
    "profit_keeps_pace": "Operating income growth kept pace with revenue growth",
}
STATUSES = ("supported", "contradicted", "unavailable")
ADJUSTMENT = re.compile(r"[+-]?(?:0|[1-9][0-9]?)(?:\.[0-9]{1,24})?\Z")


def _adjustment(raw):
    if not isinstance(raw, str) or len(raw) > 32 or not ADJUSTMENT.fullmatch(raw):
        raise CalculationError("Cash PP&E adjustment must be a finite decimal string from -50 to 50, with at most 24 decimal places.")
    value = Decimal(raw)
    if not value.is_finite() or not Decimal(-50) <= value <= Decimal(50):
        raise CalculationError("Cash PP&E adjustment must be from -50 to 50 percent.")
    return Decimal(0) if value == 0 else value


def _growth(base, current):
    return (current / base - 1) * 100 if base > 0 else None


def _status(base, current, revenue_base, revenue_current):
    if base <= 0 or revenue_base <= 0:
        return "unavailable"
    # Positive denominators permit an exact cross-product comparison. A rounded
    # percentage or a recurring break-even decimal must not decide equality.
    return "supported" if current * revenue_base >= revenue_current * base else "contradicted"


def _formula(identifier, label, value, unit, expression, operands, hypothetical=False):
    return {"id": identifier, "label": label, "value": exact(value), "unit": unit,
            "formula": expression, "operand_ids": list(dict.fromkeys(operands)),
            "method": "calculated", "hypothetical": hypothetical}


def _read_sources(engine, ticker):
    if not isinstance(engine, FilingEngine) or not isinstance(engine.fixture, dict):
        raise CalculationError("The claim board requires SEC filing engines.")
    dataset = engine.fixture.get("dataset", {})
    if (not isinstance(dataset, dict) or dataset.get("ticker") != ticker
            or dataset.get("company") != COMPANIES[ticker]["company"]
            or list(engine.periods) != list(PERIODS) or dataset.get("periods") != engine.periods):
        raise CalculationError("The claim board requires the fixed company and annual fiscal scope.")
    operands, facts = {}, []
    for period in PERIODS:
        period_ops = []
        for metric in TAGS:
            operand = engine.fact(period, metric)
            if operand.unit != "USD_millions":
                raise CalculationError("Claim operands must use a common USD millions scale.")
            evidence = engine.evidence(operand)
            # Reconcile the serialized proof with both the operand and the
            # retained original USD amount. Matching two derived values alone
            # would not catch a substituted operand passed through evidence().
            reported = number(evidence.get("reported_value")) / 1_000_000
            reported = -reported if metric == "cash_ppe_signed" else reported
            if (reported != operand.value or number(evidence.get("value")) != operand.value
                    or number(evidence.get("normalized_usd")) != operand.value * 1_000_000
                    or evidence.get("id") != operand.id or evidence.get("unit") != operand.unit
                    or evidence.get("reported_unit") != "USD" or evidence.get("method") != "reported"
                    or (evidence.get("start"), evidence.get("end")) != (operand.start, operand.end)):
                raise CalculationError("Claim operand does not reconcile with its retained source evidence.")
            dates = engine.periods[period]
            if (dates.get("frequency") != "annual"
                    or (operand.start, operand.end) != (dates.get("start"), dates.get("end"))):
                raise CalculationError("Claim operands must match their exact annual fiscal dates.")
            operands[operand.id] = operand
            period_ops.append(operand)
            facts.append(evidence)
        validate_operands(*period_ops)
    validate_operands(*operands.values(), same_period=False)
    return operands, facts, [{"id": period, **deepcopy(engine.periods[period])} for period in PERIODS]


def _company(engine, ticker, claim_id, adjustment):
    cash = claim_id == "cash_keeps_pace"
    label = "Calculated FCF growth" if cash else "Operating income growth"
    result = {"ticker": ticker, "company": COMPANIES[ticker]["company"], "period_details": [],
        "actual_status": "unavailable", "scenario_status": "unavailable", "actual_growth": None,
        "revenue_growth": None, "scenario_growth": None, "actual_growth_label": label,
        "break_even_ppe": None, "break_even_adjustment_percent": None, "break_even_feasible": None,
        "break_even_within_scenario_range": None, "break_even_note": None,
        "actuals": [], "scenario_ppe": None, "scenario_fcf": None, "formulas": [], "facts": [],
        "citations": [], "reason": None}
    if ticker not in DEFAULT_COMPANIES:
        result.update(fiscal_calendar=COMPANIES[ticker]["fiscal_calendar"],
                      fiscal_calendar_label=COMPANIES[ticker]["fiscal_calendar_label"],
                      measurement_note=COMPANIES[ticker].get("measurement_note", DEFAULT_MEASUREMENT_NOTE))
    try:
        operands, facts, details = _read_sources(engine, ticker)
    except (CalculationError, KeyError, TypeError, AttributeError, ValueError):
        result["reason"] = "A required annual SEC source fact is unavailable or inconsistent."
        return result
    result.update(facts=deepcopy(facts), period_details=details)
    seen_sources = set()
    for fact in facts:
        if fact["source_id"] not in seen_sources:
            result["citations"].append({key: fact[key] for key in
                ("source_id", "document", "url", "accession", "filed", "source_sha256")})
            seen_sources.add(fact["source_id"])
    values = {}
    formulas = result["formulas"]
    for period in PERIODS:
        ops = {metric: operands[f"{period}.{metric}"] for metric in TAGS}
        fcf = free_cash(ops["operating_cash_flow"], ops["cash_ppe_signed"])
        values[period] = {metric: operand.value for metric, operand in ops.items()}
        values[period].update(cash_ppe=abs(ops["cash_ppe_signed"].value), fcf=fcf)
        result["actuals"].append({"period": period, "unit": "USD_millions",
                                  **{key: exact(value) for key, value in values[period].items()}})
        formulas.append(_formula(f"fcf_{period}", f"{period} calculated free cash flow", fcf, "USD_millions",
            f"{period}.operating_cash_flow - abs({period}.cash_ppe_signed)",
            [ops["operating_cash_flow"].id, ops["cash_ppe_signed"].id]))
    base, current = values[PERIODS[0]], values[PERIODS[1]]
    revenue_growth = _growth(base["revenue"], current["revenue"])
    result["revenue_growth"] = exact(revenue_growth)
    revenue_ids = [f"{period}.revenue" for period in PERIODS]
    formulas.append(_formula("revenue_growth", "Revenue growth", revenue_growth, "percent",
                             "(FY2025.revenue / FY2024.revenue - 1) * 100", revenue_ids))
    metric = "fcf" if cash else "operating_income"
    target_ids = ([f"{period}.{name}" for period in PERIODS for name in
                   ("operating_cash_flow", "cash_ppe_signed")] if cash
                  else [f"{period}.operating_income" for period in PERIODS])
    actual_growth = _growth(base[metric], current[metric])
    result["actual_growth"] = exact(actual_growth)
    result["actual_status"] = _status(base[metric], current[metric], base["revenue"], current["revenue"])
    growth_formula = ("((FY2025.operating_cash_flow - abs(FY2025.cash_ppe_signed)) / "
                      "(FY2024.operating_cash_flow - abs(FY2024.cash_ppe_signed)) - 1) * 100" if cash else
                      "(FY2025.operating_income / FY2024.operating_income - 1) * 100")
    formulas.append(_formula("actual_growth", label, actual_growth, "percent", growth_formula, target_ids))
    comparison_formula = ("(FY2025.operating_cash_flow - abs(FY2025.cash_ppe_signed)) * FY2024.revenue >= "
        "FY2025.revenue * (FY2024.operating_cash_flow - abs(FY2024.cash_ppe_signed))" if cash else
        "FY2025.operating_income * FY2024.revenue >= FY2025.revenue * FY2024.operating_income")
    # Truth is represented by the status, rather than serializing a boolean as a number.
    result["actual_comparison_formula"] = comparison_formula
    result["comparison_operand_ids"] = list(dict.fromkeys(target_ids + revenue_ids))
    if not cash:
        result["scenario_growth"] = result["actual_growth"]
        result["scenario_status"] = result["actual_status"]
    else:
        scenario_ppe = current["cash_ppe"] * (1 + adjustment / 100)
        scenario_fcf = current["operating_cash_flow"] - scenario_ppe
        scenario_growth = _growth(base["fcf"], scenario_fcf)
        result.update(scenario_ppe=exact(scenario_ppe), scenario_fcf=exact(scenario_fcf),
                      scenario_growth=exact(scenario_growth),
                      scenario_status=_status(base["fcf"], scenario_fcf, base["revenue"], current["revenue"]))
        scenario_ids = ["FY2025.cash_ppe_signed"]
        formulas.append(_formula("scenario_ppe", "Hypothetical FY2025 cash PP&E payments", scenario_ppe,
            "USD_millions", "abs(FY2025.cash_ppe_signed) * (1 + cash_ppe_adjustment_percent / 100)", scenario_ids, True))
        formulas.append(_formula("scenario_fcf", "Hypothetical FY2025 calculated free cash flow", scenario_fcf,
            "USD_millions", "FY2025.operating_cash_flow - abs(FY2025.cash_ppe_signed) * (1 + cash_ppe_adjustment_percent / 100)",
            ["FY2025.operating_cash_flow", *scenario_ids], True))
        formulas.append(_formula("scenario_growth", "Hypothetical calculated FCF growth", scenario_growth, "percent",
            "((FY2025.operating_cash_flow - abs(FY2025.cash_ppe_signed) * (1 + cash_ppe_adjustment_percent / 100)) / "
            "(FY2024.operating_cash_flow - abs(FY2024.cash_ppe_signed)) - 1) * 100", target_ids, True))
        result["scenario_comparison_formula"] = (
            "(FY2025.operating_cash_flow - abs(FY2025.cash_ppe_signed) * (1 + cash_ppe_adjustment_percent / 100)) * "
            "FY2024.revenue >= FY2025.revenue * (FY2024.operating_cash_flow - abs(FY2024.cash_ppe_signed))")
        if base["revenue"] > 0 and base["fcf"] > 0:
            required_ppe = current["operating_cash_flow"] - base["fcf"] * current["revenue"] / base["revenue"]
            required_change = ((required_ppe / current["cash_ppe"] - 1) * 100
                               if current["cash_ppe"] > 0 else None)
            result.update(break_even_ppe=exact(required_ppe), break_even_adjustment_percent=exact(required_change),
                          break_even_feasible=required_ppe >= 0,
                          break_even_within_scenario_range=(required_ppe >= 0 and required_change is not None
                                                           and -50 <= required_change <= 50))
            result["break_even_note"] = ("Equality would require negative cash PP&E payments, which is infeasible in a nonnegative spending scenario."
                if required_ppe < 0 else "Equality is algebra on retained figures, not a business cause.")
            if current["cash_ppe"] == 0:
                result["break_even_note"] += " A relative adjustment is unavailable because reported current-year PP&E payments are zero."
            formulas.append(_formula("break_even_ppe", "FY2025 cash PP&E payments at equal growth", required_ppe, "USD_millions",
                "FY2025.operating_cash_flow - (FY2024.operating_cash_flow - abs(FY2024.cash_ppe_signed)) * "
                "(FY2025.revenue / FY2024.revenue)", target_ids + revenue_ids, True))
            formulas.append(_formula("break_even_adjustment_percent", "PP&E adjustment at equal growth", required_change, "percent",
                "((FY2025.operating_cash_flow - (FY2024.operating_cash_flow - abs(FY2024.cash_ppe_signed)) * "
                "(FY2025.revenue / FY2024.revenue)) / abs(FY2025.cash_ppe_signed) - 1) * 100",
                target_ids + revenue_ids, True))
    if result["actual_status"] == "unavailable":
        result["reason"] = "Growth comparison is unavailable because starting revenue or the starting claim measure is not positive."
    return result


def audit_claim(engines, claim_id, cash_ppe_adjustment_percent="0"):
    """Return one to three independently sourced within-company historical tests.

    Adjustments are explicit strings from -50 to 50 with at most 24 decimal
    places. Only FY2025 PP&E changes in the scenario; sources always stay actual.
    Decimal calculations use 80 significant digits and claim truth uses exact
    cross-products within the bounded source/input precision.
    """
    if not isinstance(claim_id, str) or claim_id not in CLAIMS:
        raise CalculationError("Select cash_keeps_pace or profit_keeps_pace.")
    adjustment = _adjustment(cash_ppe_adjustment_percent)
    if claim_id == "profit_keeps_pace" and adjustment != 0:
        raise CalculationError("Cash PP&E sensitivity applies only to the cash_keeps_pace claim.")
    if not isinstance(engines, dict):
        raise CalculationError("The claim board requires selected filing engines.")
    selected = select_companies(tuple(engines))
    with localcontext() as context:
        context.prec = 80
        companies = [_company(engines[ticker], ticker, claim_id, adjustment) for ticker in selected]
    return {"claim_id": claim_id, "claim": CLAIMS[claim_id], "periods": list(PERIODS),
        "comparison_basis": "Each company's own FY2024 to FY2025 annual fiscal periods; exact dates differ across companies.",
        "sensitivity": {"cash_ppe_adjustment_percent": exact(adjustment),
                        "hypothetical": claim_id == "cash_keeps_pace",
                        "applies_to": "FY2025 cash PP&E payments" if claim_id == "cash_keeps_pace" else None,
                        "note": "Reported source facts remain actual. This scenario is arithmetic on retained figures, not a causal explanation."},
        "actual_counts": {status: sum(card["actual_status"] == status for card in companies) for status in STATUSES},
        "scenario_counts": {status: sum(card["scenario_status"] == status for card in companies) for status in STATUSES},
        "companies": companies}
