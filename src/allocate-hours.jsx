import { t, numberText, dateText, monthText, invoke } from './i18n-ui.js';
import React, { useState } from 'react';
import { Button, Checkbox, DynamicTable, Inline, Label, Link, Modal, ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition, SectionMessage, Stack, Text, Textfield } from '@forge/react';
import { hourUnits, splitHours } from './kup-allocation.js';

export function AllocateHours({ issues, month, recordedHours, effectiveBase, maxPercent, onSaved }) {
  const [selected, setSelected] = useState([]);
  const [open, setOpen] = useState(false);
  const [total, setTotal] = useState('');
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState(null);
  const [refreshError, setRefreshError] = useState(false);
  const units = hourUnits(total);
  const draftUnits = draft?.reduce((sum, item) => sum + (hourUnits(item.hours) || 0), 0);
  const valid = units && draft && draft.every(item => hourUnits(item.hours)) && draftUnits === units;
  const projected = Number(recordedHours || 0) + (units || 0) / 100;
  const selectedIssues = issues.filter(issue => selected.includes(issue.key));

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    const outcomes = [];
    for (const item of draft) {
      try {
        const result = await invoke('saveAllocatedHours', { key: item.key, month, hours: Number(item.hours) });
        outcomes.push({ key: item.key, ...result });
      } catch {
        outcomes.push({ key: item.key, error: t("Save could not be confirmed. Refresh and check this issue before retrying.") });
      }
    }
    setResults(outcomes);
    setSaving(false);
  };

  const close = async () => {
    if (saving) return;
    if (results) {
      // Refresh from Jira after any attempted batch, including uncertain network
      // outcomes. Never silently retry the entire allocation after partial saves.
      try { await onSaved(); } catch { setRefreshError(true); return; }
    }
    setOpen(false);
    setDraft(null);
    setResults(null);
    setSelected([]);
    setRefreshError(false);
  };

  return <Stack space="space.150">
    <DynamicTable head={{ cells: [
      { key: 'select', content: t("Select") }, { key: 'key', content: t("Issue") }, { key: 'summary', content: t("Summary") }, { key: 'resolved', content: t("Completed") },
    ] }} rows={issues.map(issue => ({ key: issue.key, cells: [
      { key: 'select', content: <Checkbox label={t("Select {0}", [issue.key])} isChecked={selected.includes(issue.key)} onChange={event => {
        setSelected(current => event.target.checked ? [...current, issue.key] : current.filter(key => key !== issue.key));
      }} /> },
      { key: 'key', content: <Link href={`/browse/${issue.key}`} openNewTab>{issue.key}</Link> },
      { key: 'summary', content: <Text>{issue.summary}</Text> },
      { key: 'resolved', content: <Text>{dateText(issue.resolvedAt, false)}</Text> },
    ] }))} emptyView={t("No completed issues without KUP hours were found for this month.")} />
    <Button isDisabled={!selectedIssues.length} onClick={() => { setTotal(''); setOpen(true); }}>{t('Distribute hours ({0})', [numberText(selectedIssues.length)])}</Button>
    <ModalTransition>{open && <Modal onClose={close}>
      <ModalHeader><ModalTitle>{t('Distribute KUP hours — {0}', [monthText(month)])}</ModalTitle></ModalHeader>
      <ModalBody><Stack space="space.200">
        <Text>{t("Select only work that qualifies as creative work. These hours will be added to the selected issues.")}</Text>
        <Label labelFor="allocation-total">{t("Hours to distribute")}</Label>
        <Textfield id="allocation-total" type="number" min="0.01" max="744" step="0.01" value={total} isDisabled={saving || !!results} onChange={event => { setTotal(event.target.value); setDraft(null); }} />
        <Text>{t('Already recorded: {0} h · Adding: {1} h · Monthly total: {2} h', [numberText(recordedHours || 0), numberText((units || 0) / 100), numberText(projected)])}</Text>
        {((effectiveBase > 0 && projected > effectiveBase) || (maxPercent > 0 && effectiveBase > 0 && projected > effectiveBase * maxPercent / 100)) && <SectionMessage appearance="warning"><Text>{t("The proposed monthly total exceeds your working-hour base or the company KUP limit. Review the allocation before saving. Company approval rules still apply.")}</Text></SectionMessage>}
        <Button isDisabled={saving || !!results || !splitHours(total, selectedIssues.length)} onClick={() => {
          const hours = splitHours(total, selectedIssues.length);
          setDraft(selectedIssues.map((issue, index) => ({ key: issue.key, hours: String(hours[index]) })));
        }}>{t("Split equally")}</Button>
        {draft?.map((item, index) => <Inline key={item.key} space="space.150" alignBlock="center">
          <Label labelFor={`allocation-${item.key}`}>{item.key}</Label>
          <Textfield id={`allocation-${item.key}`} type="number" min="0.01" step="0.01" value={item.hours} isDisabled={saving || !!results} onChange={event => {
            const value = event.target.value;
            setDraft(current => current.map((row, i) => i === index ? { ...row, hours: value } : row));
          }} />
        </Inline>)}
        {draft && !valid && <Text>{t('The issue hours must add up to {0} h. Use positive values with up to two decimal places.', [numberText(total)])}</Text>}
        {results && <SectionMessage appearance={results.some(item => item.error) ? 'warning' : 'confirmation'}>
          <Text>{t('Saved hours on {0} of {1} issues.', [numberText(results.filter(item => item.saved).length), numberText(results.length)])}</Text>
          {results.filter(item => item.error).map(item => <Text key={item.key}>{item.key}: {item.error}</Text>)}
        </SectionMessage>}
        {refreshError && <Text>{t("Unable to refresh the report. Try closing again or reload the page.")}</Text>}
      </Stack></ModalBody>
      <ModalFooter>
        <Button isDisabled={saving} onClick={close}>{results ? t("Close and refresh") : t("Cancel")}</Button>
        {!results && <Button appearance="primary" isDisabled={!valid || saving} onClick={save}>{saving ? t("Saving...") : t("Confirm and save")}</Button>}
      </ModalFooter>
    </Modal>}</ModalTransition>
  </Stack>;
}
