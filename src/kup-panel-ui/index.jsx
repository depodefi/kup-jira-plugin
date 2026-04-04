import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Text, Select, Textfield, Button, Box, Stack, Inline, Heading, SectionMessage,
  Label, Spinner, Strong, Em, Lozenge
} from '@forge/react';
import { invoke, router } from '@forge/bridge';

/**
 * KUP Compliance Panel — renders inside the Jira Issue Context sidebar.
 * Shows KUP Month + Hours inputs for eligible issues, plus a full audit trail.
 * Uses progressive loading: form renders first, audit log fetched separately.
 */
const KupPanel = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [eligible, setEligible] = useState(false);
  const [months, setMonths] = useState([]);
  const [kupMonth, setKupMonth] = useState(null);
  const [kupHours, setKupHours] = useState('');
  const [auditLog, setAuditLog] = useState(null); // null = not yet loaded
  const [message, setMessage] = useState(null);
  const [approval, setApproval] = useState(null);
  const [globalPagePath, setGlobalPagePath] = useState(null);

  // Phase 1: load essential form data
  useEffect(() => {
    invoke('getPanelData').then((data) => {
      if (!data.eligible) {
        setEligible(false);
        setLoading(false);
        return;
      }

      setEligible(true);
      setMonths(data.availableMonths.map(m => ({ label: m, value: m })));

      if (data.kupData) {
        setKupMonth(data.kupData.kupMonth
          ? { label: data.kupData.kupMonth, value: data.kupData.kupMonth }
          : null
        );
        setKupHours(data.kupData.kupHours != null ? String(data.kupData.kupHours) : '');
      }

      setApproval(data.approval || null);
      setGlobalPagePath(data.globalPagePath || null);
      setLoading(false);
    }).catch((err) => {
      console.error('Failed to load panel data:', err);
      setEligible(false);
      setLoading(false);
    });
  }, []);

  // Phase 2: load audit log after form is visible
  useEffect(() => {
    if (!eligible) return;
    invoke('getAuditLog').then((data) => {
      setAuditLog(data.auditLog || []);
    }).catch(() => {
      setAuditLog([]);
    });
  }, [eligible]);

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
        setMessage({ type: 'success', text: 'KUP data saved successfully.' });
        if (result.auditLog) setAuditLog(result.auditLog);
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to save.' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Unexpected error.' });
    } finally {
      setSaving(false);
    }
  };

  // --- LOADING STATE: show form skeleton so layout is visible immediately ---
  if (loading) {
    return (
      <Box padding="space.200">
        <Stack space="space.200">
          <Box>
            <Label labelFor="kup-month-select-loading">KUP Month</Label>
            <Select
              inputId="kup-month-select-loading"
              options={[]}
              placeholder="Loading..."
              isDisabled={true}
            />
          </Box>
          <Box>
            <Label labelFor="kup-hours-input-loading">KUP Hours</Label>
            <Textfield
              id="kup-hours-input-loading"
              type="number"
              placeholder="Loading..."
              isDisabled={true}
            />
          </Box>
          <Box>
            <Button appearance="primary" isDisabled={true}>Save KUP Data</Button>
          </Box>
        </Stack>
      </Box>
    );
  }

  // --- NOT ELIGIBLE STATE ---
  if (!eligible) {
    return (
      <Box padding="space.200">
        <Text>KUP tracking is not configured for this issue type.</Text>
      </Box>
    );
  }

  const isApproved = approval?.status === 'approved';

  const approvedAtFormatted = approval?.approvedAt
    ? new Date(approval.approvedAt).toLocaleDateString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      })
    : null;

  // --- ELIGIBLE: FORM + AUDIT LOG ---
  return (
    <Box padding="space.200">
      <Stack space="space.200">
        {/* Approval banner */}
        {isApproved && (
          <SectionMessage appearance="confirmation">
            <Text>Approved by <Strong>{approval.approvedByName}</Strong> on {approvedAtFormatted}</Text>
          </SectionMessage>
        )}

        {/* Pending lozenge */}
        {!isApproved && approval?.status === 'pending' && (
          <Inline><Lozenge appearance="inprogress">Pending approval</Lozenge></Inline>
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
        <Box>
          <Label labelFor="kup-month-select">KUP Month</Label>
          <Select
            inputId="kup-month-select"
            options={months}
            value={kupMonth}
            onChange={(val) => setKupMonth(val)}
            placeholder="Select month (YYYY-MM-KUP)..."
            isClearable={true}
            isDisabled={isApproved}
          />
        </Box>

        {/* KUP Hours input */}
        <Box>
          <Label labelFor="kup-hours-input">KUP Hours</Label>
          <Textfield
            id="kup-hours-input"
            type="number"
            value={kupHours}
            onChange={(e) => {
              const val = e.target.value;
              if (val === '' || Number(val) >= 0) setKupHours(val);
            }}
            placeholder="e.g. 5"
            isDisabled={isApproved}
          />
        </Box>

        {/* Explicit save button */}
        {!isApproved && (
          <Box>
            <Button appearance="primary" onClick={handleSave} isDisabled={saving}>
              {saving ? 'Saving...' : 'Save KUP Data'}
            </Button>
          </Box>
        )}

        {/* Link to KUP Compliance report */}
        {globalPagePath && (
          <Box>
            <Button appearance="subtle" onClick={() => router.navigate(globalPagePath)}>
              View KUP Compliance Report →
            </Button>
          </Box>
        )}

        {/* Compliance Audit Trail — loads after form is visible */}
        <Box paddingBlockStart="space.300">
          <Heading size="xsmall">Compliance Activity</Heading>
          {auditLog === null && <Spinner size="small" />}
          {auditLog !== null && auditLog.length === 0 && (
            <Text>No activity recorded yet.</Text>
          )}
          {auditLog !== null && auditLog.length > 0 && (
            <Stack space="space.100">
              {auditLog.slice().reverse().map((entry, idx) => {
                const date = new Date(entry.timestamp);
                const dateStr = date.toLocaleDateString('en-GB', {
                  day: '2-digit', month: 'short', year: 'numeric',
                  hour: '2-digit', minute: '2-digit'
                });
                const changeDescs = Object.entries(entry.changes).map(
                  ([field, diff]) => `${field}: ${diff.from || '—'} → ${diff.to || '—'}`
                );
                const displayName = entry.userName || entry.userId;
                const emailDisplay = entry.userEmail ? ` (${entry.userEmail})` : '';
                const userDisplay = `${displayName}${emailDisplay}`;

                return (
                  <Box key={idx} padding="space.100">
                    <Stack space="space.050">
                      <Text><Em>{dateStr}</Em> — <Strong>{userDisplay}</Strong></Text>
                      {changeDescs.map((desc, i) => (
                        <Text key={i}>  • {desc}</Text>
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

ForgeReconciler.render(<KupPanel />);
