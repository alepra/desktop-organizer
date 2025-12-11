import React from 'react';

function FolderGridPlaceholder({ message }) {
  return (
    <div style={{
      flex: 1,
      margin: '0 auto',
      maxWidth: '800px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      <div className="placeholder-box" style={{
        width: '100%',
        minHeight: '400px'
      }}>
        <div style={{ textAlign: 'center' }}>
          <span className="placeholder-text">Folder Grid Placeholder</span>
          {message && (
            <div style={{ marginTop: '10px', color: '#999', fontSize: '14px' }}>
              IPC Message: {message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default FolderGridPlaceholder;

