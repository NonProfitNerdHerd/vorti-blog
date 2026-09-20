import * as migration_20250929_111647 from './20250929_111647';
import * as migration_20260916_190635_plugin_foundation from './20260916_190635_plugin_foundation';
import * as migration_20260916_210118_cms_content_management from './20260916_210118_cms_content_management';
import * as migration_20260917_163401_design_system_stage1 from './20260917_163401_design_system_stage1';
import * as migration_20260917_165910_design_system_stage2 from './20260917_165910_design_system_stage2';
import * as migration_20260918_135802_design_system_stage3 from './20260918_135802_design_system_stage3';
import * as migration_20260919_214810_template_layout_tree from './20260919_214810_template_layout_tree';
import * as migration_20260920_203815_template_custom_fields from './20260920_203815_template_custom_fields';

export const migrations = [
  {
    up: migration_20250929_111647.up,
    down: migration_20250929_111647.down,
    name: '20250929_111647',
  },
  {
    up: migration_20260916_190635_plugin_foundation.up,
    down: migration_20260916_190635_plugin_foundation.down,
    name: '20260916_190635_plugin_foundation',
  },
  {
    up: migration_20260916_210118_cms_content_management.up,
    down: migration_20260916_210118_cms_content_management.down,
    name: '20260916_210118_cms_content_management',
  },
  {
    up: migration_20260917_163401_design_system_stage1.up,
    down: migration_20260917_163401_design_system_stage1.down,
    name: '20260917_163401_design_system_stage1',
  },
  {
    up: migration_20260917_165910_design_system_stage2.up,
    down: migration_20260917_165910_design_system_stage2.down,
    name: '20260917_165910_design_system_stage2',
  },
  {
    up: migration_20260918_135802_design_system_stage3.up,
    down: migration_20260918_135802_design_system_stage3.down,
    name: '20260918_135802_design_system_stage3',
  },
  {
    up: migration_20260919_214810_template_layout_tree.up,
    down: migration_20260919_214810_template_layout_tree.down,
    name: '20260919_214810_template_layout_tree',
  },
  {
    up: migration_20260920_203815_template_custom_fields.up,
    down: migration_20260920_203815_template_custom_fields.down,
    name: '20260920_203815_template_custom_fields'
  },
];
