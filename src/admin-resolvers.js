import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import kvs from '@forge/kvs';
import { DEFAULT_WORKING_HOURS, defaultAvailableMonths } from './kup-defaults.js';

const MONTH_REGEX = /^\d{4}-\d{2}-KUP$/;
const ACCOUNT_ID_REGEX = /^[a-zA-Z0-9:-]{1,128}$/;
const GROUP_ID_REGEX = /^[a-zA-Z0-9-]{1,64}$/;
const ENTITY_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/; // project / issue type IDs
const CUSTOM_FIELD_REGEX = /^customfield_\d{1,10}$/;

const KNOWN_CONFIG_KEYS = [
  'enableAll', 'enabledProjects', 'enabledIssueTypes', 'projectSpecificIssueTypes',
  'availableMonths', 'monthWorkingHours', 'managerUsers', 'managerGroups',
  'maxKupPercent', 'kupLimitEnforcement', 'exportFieldMappings',
];

const isStringArray = (v, regex, maxLen) =>
  Array.isArray(v) && v.length <= maxLen && v.every(s => typeof s === 'string' && regex.test(s));

// Returns an error string, or null when the payload is a valid kup_config.
// Every key is optional (partial configs existed historically) but must be
// well-formed when present; unknown keys are rejected outright.
function validateKupConfig(payload) {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return 'Config must be an object';
  }
  const unknown = Object.keys(payload).filter(k => !KNOWN_CONFIG_KEYS.includes(k));
  if (unknown.length > 0) return `Unknown config keys: ${unknown.join(', ')}`;

  const { enableAll, enabledProjects, enabledIssueTypes, projectSpecificIssueTypes,
    availableMonths, monthWorkingHours, managerUsers, managerGroups,
    maxKupPercent, kupLimitEnforcement, exportFieldMappings } = payload;

  if (enableAll !== undefined && typeof enableAll !== 'boolean') {
    return 'enableAll must be a boolean';
  }
  if (enabledProjects !== undefined && !isStringArray(enabledProjects, ENTITY_ID_REGEX, 1000)) {
    return 'enabledProjects must be an array of project IDs';
  }
  if (enabledIssueTypes !== undefined && !isStringArray(enabledIssueTypes, ENTITY_ID_REGEX, 1000)) {
    return 'enabledIssueTypes must be an array of issue type IDs';
  }
  if (projectSpecificIssueTypes !== undefined) {
    if (typeof projectSpecificIssueTypes !== 'object' || projectSpecificIssueTypes === null || Array.isArray(projectSpecificIssueTypes)) {
      return 'projectSpecificIssueTypes must be an object';
    }
    for (const [projectId, issueTypes] of Object.entries(projectSpecificIssueTypes)) {
      if (!ENTITY_ID_REGEX.test(projectId) || !isStringArray(issueTypes, ENTITY_ID_REGEX, 200)) {
        return 'projectSpecificIssueTypes must map project IDs to arrays of issue type IDs';
      }
    }
  }
  if (availableMonths !== undefined && !isStringArray(availableMonths, MONTH_REGEX, 120)) {
    return 'availableMonths must be an array of YYYY-MM-KUP strings';
  }
  if (monthWorkingHours !== undefined) {
    if (typeof monthWorkingHours !== 'object' || monthWorkingHours === null || Array.isArray(monthWorkingHours)) {
      return 'monthWorkingHours must be an object';
    }
    for (const [month, hours] of Object.entries(monthWorkingHours)) {
      if (!MONTH_REGEX.test(month) || typeof hours !== 'number' || isNaN(hours) || hours < 0 || hours > 744) {
        return 'monthWorkingHours must map YYYY-MM-KUP to a number between 0 and 744';
      }
    }
  }
  if (managerUsers !== undefined && !isStringArray(managerUsers, ACCOUNT_ID_REGEX, 500)) {
    return 'managerUsers must be an array of account IDs';
  }
  if (managerGroups !== undefined && !isStringArray(managerGroups, GROUP_ID_REGEX, 100)) {
    return 'managerGroups must be an array of group IDs';
  }
  if (maxKupPercent !== undefined && maxKupPercent !== null
      && (typeof maxKupPercent !== 'number' || isNaN(maxKupPercent) || maxKupPercent < 1 || maxKupPercent > 100)) {
    return 'maxKupPercent must be null or a number between 1 and 100';
  }
  if (kupLimitEnforcement !== undefined && !['warn', 'block'].includes(kupLimitEnforcement)) {
    return 'kupLimitEnforcement must be "warn" or "block"';
  }
  if (exportFieldMappings !== undefined) {
    if (typeof exportFieldMappings !== 'object' || exportFieldMappings === null || Array.isArray(exportFieldMappings)) {
      return 'exportFieldMappings must be an object';
    }
    const extraMappingKeys = Object.keys(exportFieldMappings).filter(k => !['employeeId', 'costCenter'].includes(k));
    if (extraMappingKeys.length > 0) return `Unknown exportFieldMappings keys: ${extraMappingKeys.join(', ')}`;
    for (const key of ['employeeId', 'costCenter']) {
      const value = exportFieldMappings[key];
      if (value !== undefined && value !== null && !(typeof value === 'string' && CUSTOM_FIELD_REGEX.test(value))) {
        return `exportFieldMappings.${key} must be null or a custom field ID (customfield_NNN)`;
      }
    }
  }
  return null;
}

const adminResolver = new Resolver();

// Fetch available Projects and Issue Types
adminResolver.define('getJiraContext', async () => {
  // Fetch Projects
  const projectsRes = await api.asApp().requestJira(route`/rest/api/3/project/search`);
  const projectsData = await projectsRes.json();
  const projects = projectsData.values.map(p => ({
    id: p.id,
    key: p.key,
    name: p.name,
  }));

  // Fetch Issue Types
  const issueTypesRes = await api.asApp().requestJira(route`/rest/api/3/issuetype`);
  const issueTypesData = await issueTypesRes.json();
  const issueTypes = issueTypesData.map(it => ({
    id: it.id,
    name: it.name,
  }));

  return { projects, issueTypes };
});

// Get currently saved KUP configuration
adminResolver.define('getKupConfig', async () => {
  const config = await kvs.get('kup_config');
  
  // If undefined or empty (first install/never configured), default to the current year
  let availableMonths = config?.availableMonths;
  if (!availableMonths || availableMonths.length === 0) {
    availableMonths = defaultAvailableMonths();
  }

  let monthWorkingHours = config?.monthWorkingHours;
  if (!monthWorkingHours) {
    monthWorkingHours = DEFAULT_WORKING_HOURS;
    await kvs.set('kup_config', { ...(config || {}), monthWorkingHours });
  }

  return {
    ...(config || { enabledProjects: [], enabledIssueTypes: [] }),
    availableMonths,
    monthWorkingHours,
    managerUsers: config?.managerUsers || [],
    managerGroups: config?.managerGroups || [],
    maxKupPercent: config?.maxKupPercent ?? null,
    kupLimitEnforcement: config?.kupLimitEnforcement ?? 'warn',
    exportFieldMappings: config?.exportFieldMappings ?? { employeeId: null, costCenter: null },
  };
});

// Save KUP configuration
adminResolver.define('saveKupConfig', async ({ payload }) => {
  if (!payload) return { success: false, error: 'No payload provided' };

  const validationError = validateKupConfig(payload);
  if (validationError) return { success: false, error: validationError };

  await kvs.set('kup_config', payload);
  return { success: true };
});

// Fetch all custom fields available on the Jira instance (for export field mappings)
adminResolver.define('getCustomFields', async () => {
  const res = await api.asApp().requestJira(route`/rest/api/3/field`);
  const fields = await res.json();
  return (Array.isArray(fields) ? fields : [])
    .filter(f => f.custom === true)
    .map(f => ({ id: f.id, name: f.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
});

// Fetch available Jira groups for the Manager role picker
adminResolver.define('getJiraGroups', async () => {
  const res = await api.asApp().requestJira(route`/rest/api/3/groups/picker?query=&maxResults=50`);
  const data = await res.json();
  return (data.groups || []).map(g => ({ groupId: g.groupId, name: g.name }));
});

// Evaluate whether the current user holds the KUP Manager role
adminResolver.define('getCurrentUserRole', async ({ context }) => {
  const accountId = context.accountId;
  const config = await kvs.get('kup_config');
  const managerUsers = config?.managerUsers || [];
  const managerGroups = config?.managerGroups || [];

  if (managerUsers.includes(accountId)) return { isManager: true };
  if (managerGroups.length === 0) return { isManager: false };

  const res = await api.asApp().requestJira(route`/rest/api/3/user/groups?accountId=${accountId}`);
  if (!res.ok) return { isManager: false };

  const userGroups = await res.json();
  const userGroupIds = userGroups.map(g => g.groupId);
  return { isManager: managerGroups.some(gid => userGroupIds.includes(gid)) };
});

export const adminHandler = adminResolver.getDefinitions();
