import React from 'react';

function TopBarPlaceholder() {
  return (
    <div style={{
      width: '100%',
      height: '60px',
      borderBottom: '1px solid #ddd',
      backgroundColor: '#fff'
    }}>
      <div className="placeholder-box" style={{
        height: '100%',
        border: 'none',
        borderRadius: 0
      }}>
        <span className="placeholder-text">Top Bar Placeholder (Settings gear later)</span>
      </div>
    </div>
  );
}

export default TopBarPlaceholder;

