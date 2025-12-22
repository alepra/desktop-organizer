import React from 'react';

function ActionButtonsPlaceholder() {
  return (
    <div style={{
      position: 'absolute',
      bottom: '20px',
      right: '20px',
      width: '250px',
      height: '100px'
    }}>
      <div className="placeholder-box" style={{ height: '100%' }}>
        <span className="placeholder-text">Action Buttons Placeholder</span>
      </div>
    </div>
  );
}

export default ActionButtonsPlaceholder;

