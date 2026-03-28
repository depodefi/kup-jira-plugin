import React, { useEffect, useState } from 'react';
import ForgeReconciler, { CustomFieldEdit, Text, Select, Textfield, useProductContext } from '@forge/react';
import { invoke } from '@forge/bridge';

const App = () => {
  const context = useProductContext();
  const [isEligible, setIsEligible] = useState(null);
  const [months, setMonths] = useState([]);

  useEffect(() => {
    if (!context) return;
    invoke('isKupEligible').then(setIsEligible).catch(() => setIsEligible(false));
    invoke('getAvailableMonths')
      .then(m => setMonths(m.map(x => ({ label: x, value: x }))))
      .catch(() => setMonths([]));
  }, [context]);

  if (!context || isEligible === null) {
    return <Text>Loading KUP config...</Text>;
  }

  if (isEligible === false) {
    return <Text>KUP not configured for this issue type.</Text>;
  }

  const { extension } = context;
  const isMonthField = extension.moduleKey === 'kup-month-field';
  const isEditMode = extension.entryPoint === 'edit';
  const fieldValue = extension.fieldValue;

  if (isEditMode) {
    if (isMonthField) {
      return (
        <CustomFieldEdit 
          onSubmit={(formValue) => formValue.month} 
          header="KUP Month"
        >
          <Select 
            name="month" 
            options={months} 
            placeholder="Select a month..."
          />
        </CustomFieldEdit>
      );
    } else {
      // Hours field
      return (
        <CustomFieldEdit 
          onSubmit={(formValue) => {
            const num = Number(formValue.hours);
            return isNaN(num) || num < 0 ? 0 : num;
          }} 
          header="KUP Hours"
        >
          <Textfield 
            name="hours" 
            type="number" 
            placeholder="e.g. 5"
          />
        </CustomFieldEdit>
      );
    }
  }

  // View Mode
  return (
    <Text>{fieldValue ? String(fieldValue) : 'Not set'}</Text>
  );
};

ForgeReconciler.render(<App />);
