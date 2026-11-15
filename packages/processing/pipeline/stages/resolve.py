from taxonomy import STRUCTURAL_CLASSES


def apply(target, answers):
    """Resolve classes independently of geometry and fixture presence."""
    selected = answers["class"]["choice"]
    score = answers["class"]["confidence"]
    evidence = answers["evidence"]["noul"]
    recovered = target.get("requires_verification", False)
    target["decision"] = "removed" if recovered else "retained"
    if target["kind"] == "fixture":
        target["verification"] = {
            "resolution": "ambiguous",
            "class_basis": answers.get("class_basis", {}).get(
                "choice", "insufficient_evidence"
            ),
            "selected_class": selected,
            "selected_class_score": score,
            "evidence_score": evidence,
            "existence_score": answers["exists"]["noul"],
        }
        if selected == "ambiguous":
            return
    if recovered and (
        selected != "Door" or score < 0.9
        or answers["exists"]["noul"] < 0.9
        or answers["door_swing"]["noul"] < 0.5
    ):
        return
    if target["kind"] == "fixture" and selected == "No Icon":
        if score >= 0.99 and evidence >= 0.95 and answers["exists"]["noul"] <= 0.05:
            target["decision"] = "removed"
            target["verification"]["resolution"] = "resolved"
        return
    if target["kind"] == "room":
        resolution = selected if selected in {"ambiguous", "conflicting_room_uses"} else "resolved"
        basis = answers.get("class_basis", {}).get("choice", "insufficient_evidence")
        target["verification"] = {
            "resolution": resolution,
            "class_basis": basis,
            "selected_class": selected,
            "selected_class_score": score,
            "evidence_score": evidence,
            "single_space_score": answers["single_space"]["noul"],
        }
        # Geometry quality is diagnostic, not a veto on a supported room use.
        # Inconsistent or absent resolutions retain the original classification.
        if (
            resolution != "resolved"
            or (
                basis not in {"printed_label", "visual_context", "label_and_visual_context"}
                and not (selected == "Undefined" and basis == "insufficient_evidence")
            )
            or selected in STRUCTURAL_CLASSES
        ):
            return
    else:
        if selected in STRUCTURAL_CLASSES or score < 0.9:
            return
        if (
            not recovered
            and target["class"] not in {"Door", "Window"}
            and selected not in {"Door", "Window"}
            and {target["class"], selected} & {"Bathtub", "Sauna Bench", "Shower Cabin"}
            and "class_basis" in answers
        ):
            # The detector already supplied a fixture candidate. Resolve its type
            # from direct evidence rather than three separate high-score gates.
            if (
                answers["class_basis"]["choice"] not in {
                    "fixture_symbol", "associated_label", "symbol_and_label"
                }
                or answers["exists"]["noul"] <= 0.5
            ):
                return
        elif evidence < 0.85 or answers["exists"]["noul"] < 0.9:
            return
        if selected == "Window" and answers["door_swing"]["noul"] > 0.2:
            return
        if (
            target["class"] == "Door"
            and selected == "Window"
            and (
                answers["window"]["noul"] < 0.95 or answers["door_swing"]["noul"] > 0.1
            )
        ):
            return
        target["verification"]["resolution"] = "resolved"
    if recovered:
        target["decision"] = "verified_recovery"
        target["confidence"] = score
    if selected != target["class"]:
        target.update(class_original=target["class"], decision="relabelled")
        target["class"] = selected
        target["confidence"] = score
