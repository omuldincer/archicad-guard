import { expect, test } from 'claude-code/testing'

import { isKnownCommand, kindOf, takesDryRun } from '../hooks/lib/command-kind'
import { CHANGE_COMMANDS, DRY_RUN_COMMANDS, READ_COMMANDS, VIEW_COMMANDS } from '../hooks/lib/commands'

test('unknown, misspelt or missing names count as change (fail closed)', () => {
  expect(kindOf('elements_teleport_elements')).toBe('change')
  expect(kindOf('Elements_Get_All_Elements')).toBe('change')
  expect(kindOf(' elements_get_all_elements')).toBe('change')
  expect(kindOf('')).toBe('change')
  expect(kindOf(undefined)).toBe('change')
  expect(kindOf(null)).toBe('change')
  expect(kindOf(42)).toBe('change')
  expect(kindOf({ name: 'elements_get_all_elements' })).toBe('change')
  expect(isKnownCommand('elements_teleport_elements')).toBe(false)
})

test('reads pass, screen-only commands are view, model and file changes ask', () => {
  for (const name of ['elements_get_all_elements', 'elements_get_details_of_elements', 'elements_get3_d_bounding_boxes', 'properties_search_properties', 'library_find_library_parts', 'project_get_project_info', 'elements_query', 'app_convert_images']) {
    expect(kindOf(name)).toBe('read')
  }
  for (const name of ['navigator_set_zoom', 'app_change_window', 'elements_change_selection_of_elements', 'elements_highlight_elements', 'app_show_alert']) {
    expect(kindOf(name)).toBe('view')
  }
  for (const name of ['elements_move_elements', 'elements_delete_elements', 'elements_create_walls', 'elements_modify_walls', 'properties_set_property_values_of_elements', 'project_save_project', 'project_save_project_as_archive', 'project_open_project', 'ifc_ifc_file_operation', 'navigator_publish_publisher_set', 'library_check_libraries', 'app_set_current_window_drawing_scale']) {
    expect(kindOf(name)).toBe('change')
  }
})

test('every command is in exactly one list, and the map holds the whole Tapir list', () => {
  const all = [...READ_COMMANDS, ...VIEW_COMMANDS, ...CHANGE_COMMANDS]

  expect(new Set(all).size).toBe(all.length)
  expect(all.length).toBe(801)
  for (const name of all) expect(isKnownCommand(name)).toBe(true)
})

test('dryRun commands are all changes, deletes among them', () => {
  for (const name of DRY_RUN_COMMANDS) expect(kindOf(name)).toBe('change')
  expect(takesDryRun('elements_delete_elements')).toBe(true)
  expect(takesDryRun('elements_move_elements')).toBe(false)
  expect(takesDryRun(undefined)).toBe(false)
})

test('no read command has a change verb', () => {
  const changeVerb = /^(create|delete|modify|set|move|rename|remove|import|save|update|copy|add|apply|merge|trim|split)/

  for (const name of READ_COMMANDS) {
    const verb = name.replace(/^(project_data|solid_ops|design_options|custom_data|[a-z]+)_/, '')

    expect(changeVerb.test(verb) ? name : '').toBe('')
  }
})
