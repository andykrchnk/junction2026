from taxonomy import STRUCTURAL_CLASSES


def apply(target, answers):
    """Uncalibrated conservative policy. Retain original on insufficient evidence."""
    selected = answers["class"]["choice"]
    score = answers["class"]["confidence"]
    evidence = answers["evidence"]["noul"]
    target["decision"] = "retained"
    if target["kind"] == "fixture" and selected == "No Icon":
        if score >= 0.99 and evidence >= 0.95 and answers["exists"]["noul"] <= 0.05:
            target["decision"] = "removed"
        return
    if selected in STRUCTURAL_CLASSES or score < 0.9 or evidence < 0.85:
        return
    if target["kind"] == "room" and answers["single_space"]["noul"] < 0.85:
        return
    if target["kind"] == "fixture":
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
