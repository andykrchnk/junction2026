from taxonomy import STRUCTURAL_CLASSES


def apply(target, answers):
    """Apply resolved room-use decisions; retain conservative fixture checks."""
    selected = answers["class"]["choice"]
    score = answers["class"]["confidence"]
    evidence = answers["evidence"]["noul"]
    target["decision"] = "retained"
    if target["kind"] == "fixture" and selected == "No Icon":
        if score >= 0.99 and evidence >= 0.95 and answers["exists"]["noul"] <= 0.05:
            target["decision"] = "removed"
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
            or basis not in {"printed_label", "visual_context", "label_and_visual_context"}
            or selected in STRUCTURAL_CLASSES
        ):
            return
    else:
        if selected in STRUCTURAL_CLASSES or score < 0.9 or evidence < 0.85:
            return
        if answers["exists"]["noul"] < 0.9:
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
    if selected != target["class"]:
        target.update(class_original=target["class"], decision="relabelled")
        target["class"] = selected
        target["confidence"] = score
