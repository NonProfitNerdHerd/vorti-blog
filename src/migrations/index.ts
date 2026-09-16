import * as migration_20250929_111647 from './20250929_111647';
import * as migration_20260916_190635_plugin_foundation from './20260916_190635_plugin_foundation';
import * as migration_20260916_210118_cms_content_management from './20260916_210118_cms_content_management';

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
    name: '20260916_210118_cms_content_management'
  },
];
