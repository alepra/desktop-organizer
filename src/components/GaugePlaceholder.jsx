import React from 'react';

function GaugePlaceholder() {
  return (
    <div style={{
      position: 'absolute',
      top: '20px',
      left: '20px',
      width: '200px',
      height: '200px'
    }}>
      <div className="placeholder-box" style={{ height: '100%' }}>
        <span className="placeholder-text">Gauge Placeholder</span>
      </div>
    </div>
  );
}

export default GaugePlaceholder;

