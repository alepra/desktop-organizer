import React, { useEffect, useState } from 'react';
import TopBarPlaceholder from './components/TopBarPlaceholder';
import GaugePlaceholder from './components/GaugePlaceholder';
import FolderGridPlaceholder from './components/FolderGridPlaceholder';
import ActionButtonsPlaceholder from './components/ActionButtonsPlaceholder';

function App() {
  const [message, setMessage] = useState('');

  useEffect(() => {
    // Test IPC connection
    window.ipc.invoke('get-initial-state')
      .then(result => {
        setMessage(result.message);
      })
      .catch(err => {
        console.error('IPC Error:', err);
      });
  }, []);

  return (
    <div className="app-container">
      <TopBarPlaceholder />
      
      <div className="main-content">
        <GaugePlaceholder />
        
        <FolderGridPlaceholder message={message} />
      </div>
      
      <ActionButtonsPlaceholder />
    </div>
  );
}

export default App;

