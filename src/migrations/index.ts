import * as migration_20261025_040000_crm_tasks from './20261025_040000_crm_tasks';
import * as migration_20261025_030000_crm_correspondence_batches from './20261025_030000_crm_correspondence_batches';
import * as migration_20261024_140000_crm_households from './20261024_140000_crm_households';
import * as migration_20261024_150000_crm_fundraising from './20261024_150000_crm_fundraising';
import * as migration_20261024_160000_crm_activities from './20261024_160000_crm_activities';
import * as migration_20261024_170000_crm_jobs from './20261024_170000_crm_jobs';
import * as migration_20261024_180000_crm_commitments from './20261024_180000_crm_commitments';
import * as migration_20261024_190000_crm_memberships from './20261024_190000_crm_memberships';
import * as migration_20261024_200000_crm_opportunities from './20261024_200000_crm_opportunities';
import * as migration_20261024_210000_crm_volunteers from './20261024_210000_crm_volunteers';
import * as migration_20261024_220000_crm_correspondence from './20261024_220000_crm_correspondence';
import * as migration_20261024_230000_crm_email from './20261024_230000_crm_email';
import * as migration_20261025_010000_crm_attachments from './20261025_010000_crm_attachments';
import * as migration_20261025_020000_crm_timeline_indexes from './20261025_020000_crm_timeline_indexes';
import * as migration_20261023_200000_subsite_websites from './20261023_200000_subsite_websites';
import * as migration_20261020_213000_organization_foundation from './20261020_213000_organization_foundation';
import * as migration_20261020_222000_crm_contacts from './20261020_222000_crm_contacts';
import * as migration_20261020_233000_authority_restrictions from './20261020_233000_authority_restrictions';
import * as migration_20261020_234000_crm_finance from './20261020_234000_crm_finance';
import * as migration_20261021_080000_cms_site_ownership from './20261021_080000_cms_site_ownership';
import * as migration_20261021_090000_workspace_site_ownership from './20261021_090000_workspace_site_ownership';
import * as migration_20261022_010000_native_mutation_guards from './20261022_010000_native_mutation_guards';
import * as migration_20261023_160000_scoped_site_settings from './20261023_160000_scoped_site_settings';
import * as migration_20261023_163000_global_commit_guards from './20261023_163000_global_commit_guards';
import * as migration_20261023_170000_native_authentication_guards from './20261023_170000_native_authentication_guards';
import * as migration_20261020_200500_content_publication_views from './20261020_200500_content_publication_views';
import * as migration_20250929_111647 from './20250929_111647';
import * as migration_20260916_190635_plugin_foundation from './20260916_190635_plugin_foundation';
import * as migration_20260916_210118_cms_content_management from './20260916_210118_cms_content_management';
import * as migration_20260917_163401_design_system_stage1 from './20260917_163401_design_system_stage1';
import * as migration_20260917_165910_design_system_stage2 from './20260917_165910_design_system_stage2';
import * as migration_20260918_135802_design_system_stage3 from './20260918_135802_design_system_stage3';
import * as migration_20260919_214810_template_layout_tree from './20260919_214810_template_layout_tree';
import * as migration_20260920_203815_template_custom_fields from './20260920_203815_template_custom_fields';
import * as migration_20260923_213430_site_template_foundation from './20260923_213430_site_template_foundation';
import * as migration_20260929_163022_responsive_page_templates from './20260929_163022_responsive_page_templates';
import * as migration_20261002_200000_content_workspace from './20261002_200000_content_workspace';
import * as migration_20261011_233000_document_review from './20261011_233000_document_review';
import * as migration_20261012_040000_post_types_views from './20261012_040000_post_types_views';
import * as migration_20261012_200651_forms_module from './20261012_200651_forms_module';
import * as migration_20261012_220000_forms_payments from './20261012_220000_forms_payments';
import * as migration_20261013_000807_forms_cms_actions from './20261013_000807_forms_cms_actions';
import * as migration_20261017_195736_system_settings from './20261017_195736_system_settings';
import * as migration_20261018_001622 from './20261018_001622';
import * as migration_20261018_180337_usernames from './20261018_180337_usernames';
import * as migration_20261018_193401_tasks_workspace from './20261018_193401_tasks_workspace';
import * as migration_20261018_194411_workspace_preferences from './20261018_194411_workspace_preferences';
import * as migration_20261018_220320_projects_workspace from './20261018_220320_projects_workspace';
import * as migration_20261018_224500_projects_audience_revisions from './20261018_224500_projects_audience_revisions';
import * as migration_20261019_145037_starter_workspace from './20261019_145037_starter_workspace';
import * as migration_20261019_160802_compact_workspace from './20261019_160802_compact_workspace';
import * as migration_20261019_173505_board_refinement from './20261019_173505_board_refinement';
import * as migration_20261019_193700_compact_columns_time from './20261019_193700_compact_columns_time';
import * as migration_20261020_170954_reusable_menus from './20261020_170954_reusable_menus';
import * as migration_20261020_180749_simplify_cms from './20261020_180749_simplify_cms';
import * as migration_20261020_183100_saved_view_content_cleanup from './20261020_183100_saved_view_content_cleanup';

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
    name: '20260920_203815_template_custom_fields',
  },
  {
    up: migration_20260923_213430_site_template_foundation.up,
    down: migration_20260923_213430_site_template_foundation.down,
    name: '20260923_213430_site_template_foundation',
  },
  {
    up: migration_20260929_163022_responsive_page_templates.up,
    down: migration_20260929_163022_responsive_page_templates.down,
    name: '20260929_163022_responsive_page_templates',
  },
  {
    up: migration_20261002_200000_content_workspace.up,
    down: migration_20261002_200000_content_workspace.down,
    name: '20261002_200000_content_workspace',
  },
  {
    up: migration_20261011_233000_document_review.up,
    down: migration_20261011_233000_document_review.down,
    name: '20261011_233000_document_review',
  },
  {
    up: migration_20261012_040000_post_types_views.up,
    down: migration_20261012_040000_post_types_views.down,
    name: '20261012_040000_post_types_views',
  },
  {
    up: migration_20261012_200651_forms_module.up,
    down: migration_20261012_200651_forms_module.down,
    name: '20261012_200651_forms_module',
  },
  {
    up: migration_20261012_220000_forms_payments.up,
    down: migration_20261012_220000_forms_payments.down,
    name: '20261012_220000_forms_payments',
  },
  {
    up: migration_20261013_000807_forms_cms_actions.up,
    down: migration_20261013_000807_forms_cms_actions.down,
    name: '20261013_000807_forms_cms_actions',
  },
  {
    up: migration_20261017_195736_system_settings.up,
    down: migration_20261017_195736_system_settings.down,
    name: '20261017_195736_system_settings',
  },
  {
    up: migration_20261018_001622.up,
    down: migration_20261018_001622.down,
    name: '20261018_001622',
  },
  {
    up: migration_20261018_180337_usernames.up,
    down: migration_20261018_180337_usernames.down,
    name: '20261018_180337_usernames',
  },
  {
    up: migration_20261018_193401_tasks_workspace.up,
    down: migration_20261018_193401_tasks_workspace.down,
    name: '20261018_193401_tasks_workspace',
  },
  {
    up: migration_20261018_194411_workspace_preferences.up,
    down: migration_20261018_194411_workspace_preferences.down,
    name: '20261018_194411_workspace_preferences',
  },
  {
    up: migration_20261018_220320_projects_workspace.up,
    down: migration_20261018_220320_projects_workspace.down,
    name: '20261018_220320_projects_workspace',
  },
  {
    up: migration_20261018_224500_projects_audience_revisions.up,
    down: migration_20261018_224500_projects_audience_revisions.down,
    name: '20261018_224500_projects_audience_revisions',
  },
  {
    up: migration_20261019_145037_starter_workspace.up,
    down: migration_20261019_145037_starter_workspace.down,
    name: '20261019_145037_starter_workspace',
  },
  {
    up: migration_20261019_160802_compact_workspace.up,
    down: migration_20261019_160802_compact_workspace.down,
    name: '20261019_160802_compact_workspace',
  },
  {
    up: migration_20261019_173505_board_refinement.up,
    down: migration_20261019_173505_board_refinement.down,
    name: '20261019_173505_board_refinement',
  },
  {
    up: migration_20261019_193700_compact_columns_time.up,
    down: migration_20261019_193700_compact_columns_time.down,
    name: '20261019_193700_compact_columns_time',
  },
  {
    up: migration_20261020_170954_reusable_menus.up,
    down: migration_20261020_170954_reusable_menus.down,
    name: '20261020_170954_reusable_menus',
  },
  {
    up: migration_20261020_180749_simplify_cms.up,
    down: migration_20261020_180749_simplify_cms.down,
    name: '20261020_180749_simplify_cms'
  },
  {
    up: migration_20261020_183100_saved_view_content_cleanup.up,
    down: migration_20261020_183100_saved_view_content_cleanup.down,
    name: '20261020_183100_saved_view_content_cleanup'
  },
  { up: migration_20261020_200500_content_publication_views.up, down: migration_20261020_200500_content_publication_views.down, name: '20261020_200500_content_publication_views' },
  { up: migration_20261020_213000_organization_foundation.up, down: migration_20261020_213000_organization_foundation.down, name: '20261020_213000_organization_foundation' },
  { up: migration_20261020_222000_crm_contacts.up, down: migration_20261020_222000_crm_contacts.down, name: '20261020_222000_crm_contacts' },
  { up: migration_20261020_233000_authority_restrictions.up, down: migration_20261020_233000_authority_restrictions.down, name: '20261020_233000_authority_restrictions' },
  { up: migration_20261020_234000_crm_finance.up, down: migration_20261020_234000_crm_finance.down, name: '20261020_234000_crm_finance' },
  { up: migration_20261021_080000_cms_site_ownership.up, down: migration_20261021_080000_cms_site_ownership.down, name: '20261021_080000_cms_site_ownership' },
  { up: migration_20261021_090000_workspace_site_ownership.up, down: migration_20261021_090000_workspace_site_ownership.down, name: '20261021_090000_workspace_site_ownership' },
  { up: migration_20261022_010000_native_mutation_guards.up, down: migration_20261022_010000_native_mutation_guards.down, name: '20261022_010000_native_mutation_guards' },
  { up: migration_20261023_160000_scoped_site_settings.up, down: migration_20261023_160000_scoped_site_settings.down, name: '20261023_160000_scoped_site_settings' },
  { up: migration_20261023_163000_global_commit_guards.up, down: migration_20261023_163000_global_commit_guards.down, name: '20261023_163000_global_commit_guards' },
  { up: migration_20261023_170000_native_authentication_guards.up, down: migration_20261023_170000_native_authentication_guards.down, name: '20261023_170000_native_authentication_guards' },
  { up: migration_20261023_200000_subsite_websites.up, down: migration_20261023_200000_subsite_websites.down, name: '20261023_200000_subsite_websites' },
  { up: migration_20261024_140000_crm_households.up, down: migration_20261024_140000_crm_households.down, name: '20261024_140000_crm_households' },
  { up: migration_20261024_150000_crm_fundraising.up, down: migration_20261024_150000_crm_fundraising.down, name: '20261024_150000_crm_fundraising' },
  { up: migration_20261024_160000_crm_activities.up, down: migration_20261024_160000_crm_activities.down, name: '20261024_160000_crm_activities' },
  { up: migration_20261024_170000_crm_jobs.up, down: migration_20261024_170000_crm_jobs.down, name: '20261024_170000_crm_jobs' },
  { up: migration_20261024_180000_crm_commitments.up, down: migration_20261024_180000_crm_commitments.down, name: '20261024_180000_crm_commitments' },
  { up: migration_20261024_190000_crm_memberships.up, down: migration_20261024_190000_crm_memberships.down, name: '20261024_190000_crm_memberships' },
  { up: migration_20261024_200000_crm_opportunities.up, down: migration_20261024_200000_crm_opportunities.down, name: '20261024_200000_crm_opportunities' },
  { up: migration_20261024_210000_crm_volunteers.up, down: migration_20261024_210000_crm_volunteers.down, name: '20261024_210000_crm_volunteers' },
  { up: migration_20261024_220000_crm_correspondence.up, down: migration_20261024_220000_crm_correspondence.down, name: '20261024_220000_crm_correspondence' },
  { up: migration_20261024_230000_crm_email.up, down: migration_20261024_230000_crm_email.down, name: '20261024_230000_crm_email' },
  { up: migration_20261025_010000_crm_attachments.up, down: migration_20261025_010000_crm_attachments.down, name: '20261025_010000_crm_attachments' },
  { up: migration_20261025_020000_crm_timeline_indexes.up, down: migration_20261025_020000_crm_timeline_indexes.down, name: '20261025_020000_crm_timeline_indexes' },
  { up: migration_20261025_030000_crm_correspondence_batches.up, down: migration_20261025_030000_crm_correspondence_batches.down, name: '20261025_030000_crm_correspondence_batches' },
  { up: migration_20261025_040000_crm_tasks.up, down: migration_20261025_040000_crm_tasks.down, name: '20261025_040000_crm_tasks' },
];
