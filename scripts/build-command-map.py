"""Builds archicad-guard/hooks/lib/commands.ts from scripts/tapir-commands.txt (point 1.2).

tapir-commands.txt is the full Tapir command list, as `archicad_list_commands` (no keywords, all groups) returns it.
When Tapir adds commands: refresh that file, run `python scripts/build-command-map.py`, check the new names in the
diff, then `scripts/check.sh`. Names not in the map count as change in the guard (fail closed).

Rule: the verb after the group prefix decides (get/find/search/is/... = read), then the hand lists below win.
VIEW = changes only Archicad's screen or selection, never the model or a file (Sebastian, 2026-11-25: passes).
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "scripts" / "tapir-commands.txt"
OUT = ROOT / "archicad-guard" / "hooks" / "lib" / "commands.ts"

GROUPS = sorted([
    "analytical", "app", "attributes", "classifications", "components", "custom_data", "design_options", "dev",
    "elements", "favorites", "grouping", "ifc", "issues", "keynotes", "layout", "library", "mep", "navigator",
    "project", "project_data", "properties", "revisions", "solid_ops", "teamwork", "view",
], key=len, reverse=True)

READ_VERBS = {"get", "find", "search", "is", "compare", "measure", "read", "interpret", "calculate", "can"}

# Reads the verb rule misses: they return data and change nothing.
READ_BY_HAND = {
    "app_convert_images",            # converts images it is given, "changes nothing in the project"
    "app_model_to_screen",
    "app_screen_to_model",
    "elements_filter_elements",
    "elements_query",
    "elements_triangulate_polygons_of_elements",
    "mep_check_mep_port_connectability",
    "project_convert_unit_values",
    "project_resolve_names",
    "properties_check_property_values",
}

# Screen and selection only: pass without asking, not logged.
VIEW = {
    "app_change_window",
    "app_close_windows",
    "app_rebuild_current_database",
    "app_redraw_current_database",
    "app_set3_d_cutaway_status",
    "app_set_archicad_visibility",
    "app_set_current_tool",
    "app_show_alert",
    "app_show_notification_bubble",
    "elements_change_selection_of_elements",
    "elements_deselect_all",
    "elements_highlight_elements",
    "elements_set_marquee",
    "library_open_library_part_in_editor",
    "navigator_fit_in_window",
    "navigator_reset_zoom",
    "navigator_set_zoom",
    "navigator_show_elements_in3_d",
    "navigator_zoom_to_elements",
    "project_rebuild_view",
}

# Reads by name that must still ask. Empty today; kept so a hand override has one place.
CHANGE_BY_HAND: set[str] = set()

# Change commands that take `dryRun: true` (from their Tapir descriptions, 2026-11-25). 1.3 can show the preview.
DRY_RUN = {
    "attributes_delete_and_replace_attributes",
    "attributes_delete_attribute_folders",
    "attributes_delete_attributes",
    "attributes_delete_user_data_of_attributes",
    "attributes_import_attributes_from_project",
    "attributes_reindex_attributes",
    "attributes_reindex_layers",
    "classifications_delete_classification_items",
    "classifications_delete_classification_systems",
    "classifications_set_classifications_of_elements",
    "elements_delete_elements",
    "elements_delete_selected_elements",
    "elements_delete_user_data_of_elements",
    "elements_set_category_values_of_elements",
    "elements_set_gdl_parameters_of_elements",
    "grouping_delete_element_sets",
    "ifc_remove_ifc_classification_references_of_elements",
    "ifc_remove_ifc_properties_of_elements",
    "issues_delete_issue",
    "navigator_delete_navigator_items",
    "properties_delete_property_definitions",
    "properties_delete_property_groups",
    "properties_remove_property_from_attributes",
    "properties_set_property_values_of_elements",
    "solid_ops_remove_element_trims",
    "solid_ops_remove_solid_element_links",
}


def verb_of(name: str) -> str:
    for group in GROUPS:
        if name.startswith(group + "_"):
            return name[len(group) + 1:].split("_")[0]
    raise SystemExit(f"no known group prefix: {name}")


def kind_of(name: str) -> str:
    if name in VIEW:
        return "view"
    if name in CHANGE_BY_HAND:
        return "change"
    if name in READ_BY_HAND:
        return "read"
    verb = verb_of(name)
    # get3_d_..., get2_d_... are `get` too.
    if verb in READ_VERBS or verb.rstrip("0123456789") in READ_VERBS:
        return "read"
    return "change"


def ts_list(names: list[str]) -> str:
    return "\n".join(f"  '{n}'," for n in names)


def main() -> None:
    names = [line.strip() for line in SRC.read_text(encoding="utf-8").splitlines() if line.strip()]
    if len(names) != len(set(names)):
        raise SystemExit("duplicate names in tapir-commands.txt")
    known = set(names)
    for hand in (READ_BY_HAND | VIEW | CHANGE_BY_HAND | DRY_RUN) - known:
        raise SystemExit(f"hand list names an unknown command: {hand}")

    kinds = {n: kind_of(n) for n in names}
    for n in DRY_RUN:
        if kinds[n] != "change":
            raise SystemExit(f"dryRun command is not a change: {n}")

    by = {k: sorted(n for n in names if kinds[n] == k) for k in ("read", "view", "change")}
    text = f"""// GENERATED by scripts/build-command-map.py from scripts/tapir-commands.txt. Do not edit by hand.
// Every Tapir command sorted into read (passes), view (screen/selection only, passes) or change (asks).
// A name not in these lists is a change (fail closed): see `kindOf` in ./command-kind.ts.

export const READ_COMMANDS: readonly string[] = [
{ts_list(by["read"])}
]

export const VIEW_COMMANDS: readonly string[] = [
{ts_list(by["view"])}
]

export const CHANGE_COMMANDS: readonly string[] = [
{ts_list(by["change"])}
]

/** Change commands that take `dryRun: true`, so the guard can show what a real run would do. */
export const DRY_RUN_COMMANDS: readonly string[] = [
{ts_list(sorted(DRY_RUN))}
]
"""
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    print(f"{len(names)} commands: {len(by['read'])} read, {len(by['view'])} view, {len(by['change'])} change, "
          f"{len(DRY_RUN)} with dryRun -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
