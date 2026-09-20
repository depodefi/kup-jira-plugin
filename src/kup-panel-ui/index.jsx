import { t, numberText, dateText, monthText, initializeLocale, invoke } from '../i18n-ui.js';
import { PeriodPicker } from '../period-picker.jsx';
import { initialKupPeriod } from '../kup-period.js';
import { useLicenseStatus } from '../use-license-status.js';
import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Text, Select, Textfield, Button, Box, Stack, Inline, Heading, SectionMessage,
  Label, Spinner, Strong, Em, Lozenge, User
} from '@forge/react';
import { router } from '@forge/bridge';

function formatActivityValue(field, value) {
  if (value == null) return '—';
  if (field === 'kupHours') return numberText(value);
  if (field === 'kupMonth') return monthText(value);
  if (field === 'status') return t(value === 'approved' ? 'Approved' : 'Pending');
  return value;
}

/**
 * KUP Compliance Panel — renders inside the Jira Issue Context sidebar.
 * Shows KUP Month + Hours inputs for eligible issues, plus a full audit trail.
 * Uses progressive loading: form renders first, audit log fetched separately.
 */
const KupPanel = () => {
  const [loading, setLoading] = useState(true);
  const { licenseActive, licenseMessage, checkLicense } = useLicenseStatus();
  const [saving, setSaving] = useState(false);
  const [eligible, setEligible] = useState(false);
  const [kupMonth, setKupMonth] = useState(null);
  const [kupHours, setKupHours] = useState('');
  const [employeeAccountId, setEmployeeAccountId] = useState(null);
  const [currentAssigneeAccountId, setCurrentAssigneeAccountId] = useState(null);
  const [auditLog, setAuditLog] = useState(null); // null = not yet loaded
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [message, setMessage] = useState(null);
  const [approval, setApproval] = useState(null);
  const [globalPagePath, setGlobalPagePath] = useState(null);

  // Phase 1: load essential form data after the subscription is verified.
  useEffect(() => {
    if (licenseActive !== true) return;

    invoke('getPanelData').then((data) => {
      if (!data.eligible) {
        setEligible(false);
        setLoading(false);
        return;
      }

      setEligible(true);
      const period = initialKupPeriod(data.kupData?.kupMonth);
      setKupMonth({ label: period, value: period });

      if (data.kupData) {
        setKupHours(data.kupData.kupHours != null ? String(data.kupData.kupHours) : '');
      }
      setEmployeeAccountId(data.kupData?.employeeAccountId || data.currentAssigneeAccountId || null);
      setCurrentAssigneeAccountId(data.currentAssigneeAccountId || null);

      setApproval(data.approval || null);
      setGlobalPagePath(data.globalPagePath || null);
      setLoading(false);
    }).catch((err) => {
      console.error('Failed to load panel data');
      setEligible(false);
      setLoading(false);
    });
  }, [licenseActive]);

  // Phase 2: load audit log after form is visible
  useEffect(() => {
    if (!eligible || !showAuditLog || auditLog !== null) return;
    invoke('getAuditLog').then((data) => {
      setAuditLog(data.auditLog || []);
    }).catch(() => {
      setAuditLog([]);
    });
  }, [eligible, showAuditLog, auditLog]);

  // Handle explicit save action
  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    const payload = {
      kupMonth: kupMonth ? kupMonth.value : null,
      kupHours: kupHours,
    };

    try {
      const result = await invoke('saveKupData', payload);
      if (result.success) {
        setMessage({ type: 'success', text: t("KUP data saved successfully.") });
        setEmployeeAccountId(result.kupData?.employeeAccountId || employeeAccountId);
        setCurrentAssigneeAccountId(result.kupData?.employeeAccountId || currentAssigneeAccountId);
        if (result.auditLog) setAuditLog(result.auditLog);
      } else {
        setMessage({ type: 'error', text: result.error || t("Failed to save.") });
      }
    } catch (err) {
      setMessage({ type: 'error', text: err.message || t("Unexpected error.") });
    } finally {
      setSaving(false);
    }
  };

  // --- LOADING STATE: show form skeleton so layout is visible immediately ---
  // Data loading only starts for an active license. Otherwise `loading` stays
  // true, so it must not hide the inactive-license message below.
  if (licenseActive === null || (licenseActive === true && loading)) {
    return (
      <Box padding="space.200">
        <Stack space="space.200">
          <Box>
            <Label labelFor="kup-month-select-loading">{t("KUP Month")}</Label>
            <Select
              inputId="kup-month-select-loading"
              options={[]}
              placeholder={t("Loading...")}
              isDisabled={true}
            />
          </Box>
          <Box>
            <Label labelFor="kup-hours-input-loading">{t("KUP Hours")}</Label>
            <Textfield
              id="kup-hours-input-loading"
              type="number"
              placeholder={t("Loading...")}
              isDisabled={true}
            />
          </Box>
          <Box>
            <Button appearance="primary" isDisabled={true}>{t("Save KUP Data")}</Button>
          </Box>
        </Stack>
      </Box>
    );
  }

  if (!licenseActive) {
    return (
      <Box padding="space.200">
        <SectionMessage appearance="warning" title={licenseMessage.title}>
          <Text>{licenseMessage.text}</Text>
          <Button onClick={checkLicense}>{t("Try again")}</Button>
        </SectionMessage>
      </Box>
    );
  }

  // --- NOT ELIGIBLE STATE ---
  if (!eligible) {
    return (
      <Box padding="space.200">
        <Text>{t("KUP tracking is not configured for this issue type.")}</Text>
      </Box>
    );
  }

  const isApproved = approval?.status === 'approved';

  const approvedAtFormatted = approval?.approvedAt ? dateText(approval.approvedAt) : null;

  // --- ELIGIBLE: FORM + AUDIT LOG ---
  return (
    <Box padding="space.200">
      <Stack space="space.200">
        {/* Approval banner */}
        {isApproved && (
          <SectionMessage appearance="confirmation">
            <Inline space="space.050" alignBlock="center">
              <Text>{t("Approved by")}</Text>
              {approval.approvedBy
                ? <User accountId={approval.approvedBy} />
                : <Strong>{approval.approvedByName || t("a manager")}</Strong>}
              <Text>{t("on")}{" "}{approvedAtFormatted}</Text>
            </Inline>
          </SectionMessage>
        )}

        {/* Pending lozenge */}
        {!isApproved && approval?.status === 'pending' && (
          <Inline><Lozenge appearance="inprogress">{t("Pending approval")}</Lozenge></Inline>
        )}

        {/* Save feedback */}
        {message && (
          <SectionMessage
            appearance={message.type === 'success' ? 'success' : 'error'}
          >
            <Text>{message.text}</Text>
          </SectionMessage>
        )}

        {/* KUP Month selector */}
        {employeeAccountId && (
          <Inline space="space.050" alignBlock="center">
            <Text>{t("KUP hours attributed to")}</Text>
            <User accountId={employeeAccountId} />
          </Inline>
        )}
        {!isApproved && employeeAccountId && currentAssigneeAccountId
          && employeeAccountId !== currentAssigneeAccountId && (
          <SectionMessage appearance="warning" title={t("Assignee changed")}>
            <Inline space="space.050" alignBlock="center">
              <Text>{t("Saving will move these KUP hours to the current assignee:")}</Text>
              <User accountId={currentAssigneeAccountId} />
            </Inline>
          </SectionMessage>
        )}
        <Box>
          <PeriodPicker id="kup-period" value={kupMonth} onChange={setKupMonth} isDisabled={isApproved} />
        </Box>

        {/* KUP Hours input */}
        <Box>
          <Label labelFor="kup-hours-input">{t("KUP Hours")}</Label>
          <Textfield
            id="kup-hours-input"
            type="number"
            value={kupHours}
            onChange={(e) => {
              const val = e.target.value;
              if (val === '' || Number(val) >= 0) setKupHours(val);
            }}
            placeholder="5"
            isDisabled={isApproved}
          />
        </Box>

        {/* Explicit save button */}
        {!isApproved && (
          <Box>
            <Button appearance="primary" onClick={handleSave} isDisabled={saving}>
              {saving ? t("Saving...") : t("Save KUP Data")}
            </Button>
          </Box>
        )}

        {/* Link to the KUP 50% Compliance report */}
        {globalPagePath && (
          <Box>
            <Button appearance="subtle" onClick={() => router.navigate(globalPagePath)}>{t("View KUP 50% Compliance Report →")}</Button>
          </Box>
        )}

        {/* Compliance Audit Trail — loads after form is visible */}
        <Box paddingBlockStart="space.300">
          <Inline spread="space-between" alignBlock="center">
            <Heading size="xsmall">{t("Compliance Activity")}</Heading>
            <Button appearance="subtle" onClick={() => setShowAuditLog(current => !current)}>
              {showAuditLog ? t("Hide activity") : t("Show activity")}
            </Button>
          </Inline>
          {showAuditLog && auditLog === null && <Spinner size="small" />}
          {showAuditLog && auditLog !== null && auditLog.length === 0 && (
            <Text>{t("No activity recorded yet.")}</Text>
          )}
          {showAuditLog && auditLog !== null && auditLog.length > 0 && (
            <Stack space="space.100">
              {auditLog.slice().reverse().map((entry, idx) => {
                const dateStr = dateText(entry.timestamp);
                const fieldLabels = {
                  kupMonth: t("KUP period"),
                  kupHours: t("KUP hours"),
                };

                return (
                  <Box key={idx} padding="space.100">
                    <Stack space="space.050">
                      <Inline space="space.050" alignBlock="center">
                        <Text><Em>{dateStr}</Em> —</Text>
                        {entry.userId
                          ? <User accountId={entry.userId} />
                          : <Strong>{entry.userName || t("Unknown user")}</Strong>}
                      </Inline>
                      {Object.entries(entry.changes).map(([field, diff]) => (
                        field === 'employeeAccountId' ? (
                          <Inline key={field} space="space.050" alignBlock="center">
                            <Text>{t("• KUP hours owner:")}</Text>
                            {diff.from ? <User accountId={diff.from} /> : <Text>—</Text>}
                            <Text>→</Text>
                            {diff.to ? <User accountId={diff.to} /> : <Text>—</Text>}
                          </Inline>
                        ) : (
                          <Text key={field}>
                            • {fieldLabels[field] || t(field === 'status' ? 'Status' : field)}: {formatActivityValue(field, diff.from)} → {formatActivityValue(field, diff.to)}
                          </Text>
                        )
                      ))}
                    </Stack>
                  </Box>
                );
              })}
            </Stack>
          )}
        </Box>
      </Stack>
    </Box>
  );
};

initializeLocale().then(() => ForgeReconciler.render(<KupPanel />));
