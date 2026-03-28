import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Text, Select, Textfield, Button, Box, Stack, Heading, SectionMessage,
  Label, Spinner, Strong, Em
} from '@forge/react';
import { invoke } from '@forge/bridge';

/**
 * KUP Compliance Panel — renders inside the Jira Issue Context sidebar.
 * Shows KUP Month + Hours inputs for eligible issues, plus a full audit trail.
 */
const KupPanel = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [eligible, setEligible] = useState(false);
  const [months, setMonths] = useState([]);
  const [kupMonth, setKupMonth] = useState(null);
  const [kupHours, setKupHours] = useState('');
  const [auditLog, setAuditLog] = useState([]);
  const [message, setMessage] = useState(null);

  // Load panel data on mount
  useEffect(() => {
    invoke('getPanelData').then((data) => {
      if (!data.eligible) {
        setEligible(false);
        setLoading(false);
        return;
      }

      setEligible(true);

      // Build month options from the admin-configured availableMonths list
      setMonths(data.availableMonths.map(m => ({ label: m, value: m })));

      // Pre-fill with any previously saved values
      if (data.kupData) {
        setKupMonth(data.kupData.kupMonth
          ? { label: data.kupData.kupMonth, value: data.kupData.kupMonth }
          : null
        );
        setKupHours(data.kupData.kupHours != null ? String(data.kupData.kupHours) : '');
      }

      setAuditLog(data.auditLog || []);
      setLoading(false);
    }).catch((err) => {
      console.error('Failed to load panel data:', err);
      setEligible(false);
      setLoading(false);
    });
  }, []);

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
        // Refresh the audit log from the response
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

  // --- LOADING STATE ---
  if (loading) {
    return (
      <Box padding="space.200">
        <Spinner size="medium" />
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

  // --- ELIGIBLE: FORM + AUDIT LOG ---
  return (
    <Box padding="space.200">
      <Stack space="space.200">
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
              // Only allow positive numbers
              if (val === '' || Number(val) >= 0) setKupHours(val);
            }}
            placeholder="e.g. 5"
          />
        </Box>

        {/* Explicit save button */}
        <Box>
          <Button appearance="primary" onClick={handleSave} isDisabled={saving}>
            {saving ? 'Saving...' : 'Save KUP Data'}
          </Button>
        </Box>

        {/* Compliance Audit Trail */}
        {auditLog.length > 0 && (
          <Box paddingBlockStart="space.300">
            <Heading size="xsmall">Compliance Activity</Heading>
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
                // Handle backwards compatibility for older entries that only had userId
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
          </Box>
        )}
      </Stack>
    </Box>
  );
};

ForgeReconciler.render(<KupPanel />);
