import React, { useState } from 'react';
import { invoke } from '@forge/bridge';

function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const testGetConfig = async () => {
    setLoading(true);
    try {
      const result = await invoke('getKupConfig');
      setData(result);
    } catch (e) {
      setData({ error: e.message });
    }
    setLoading(false);
  };

  const testSaveConfig = async () => {
    setLoading(true);
    try {
      const result = await invoke('saveKupConfig', { enabledProjects: ['TEST-123'], enabledIssueTypes: ['10000'] });
      setData(result);
    } catch (e) {
      setData({ error: e.message });
    }
    setLoading(false);
  };

  const testGetContext = async () => {
    setLoading(true);
    try {
      const result = await invoke('getJiraContext');
      setData(result);
    } catch (e) {
      setData({ error: e.message });
    }
    setLoading(false);
  };

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h2>Admin UI Resolver Tests</h2>
      <div style={{ marginBottom: '20px' }}>
        <button onClick={testGetConfig} style={{ marginRight: '10px' }}>Get Config</button>
        <button onClick={testSaveConfig} style={{ marginRight: '10px' }}>Save Dummy Config</button>
        <button onClick={testGetContext}>Get Jira Context (Projects & Issue Types)</button>
      </div>
      <div>
        <h3>Result:</h3>
        {loading ? <p>Loading...</p> : <pre style={{ background: '#f4f5f7', padding: '10px', minHeight: '100px', borderRadius: '3px' }}>{JSON.stringify(data, null, 2)}</pre>}
      </div>
    </div>
  );
}

export default App;
