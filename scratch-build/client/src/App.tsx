import React, { useState } from 'react';

function App() {
  const [address, setAddress] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address.trim()) return;

    setLoading(true);
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ address }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setResult(data);
    } catch (error) {
      console.error('Analysis failed:', error);
      alert('Analysis failed: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h1>Property Vision - Scratch Build</h1>
      
      <form onSubmit={handleSubmit} style={{ marginBottom: '20px' }}>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Enter property address..."
          style={{ 
            width: '300px', 
            padding: '10px', 
            marginRight: '10px',
            border: '1px solid #ccc',
            borderRadius: '4px'
          }}
        />
        <button 
          type="submit" 
          disabled={loading || !address.trim()}
          style={{
            padding: '10px 20px',
            backgroundColor: loading ? '#ccc' : '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: loading ? 'not-allowed' : 'pointer'
          }}
        >
          {loading ? 'Analyzing...' : 'Analyze Property'}
        </button>
      </form>

      {result && (
        <div style={{ 
          border: '1px solid #ddd', 
          padding: '20px', 
          borderRadius: '4px',
          backgroundColor: '#f9f9f9'
        }}>
          <h2>Analysis Result</h2>
          <p><strong>Address:</strong> {result.address}</p>
          <p><strong>ARV:</strong> {result.arv}</p>
          <p><strong>Confidence:</strong> {result.confidence}</p>
          
          <h3>Comparables</h3>
          {result.comparables?.map((comp, index) => (
            <div key={index} style={{ marginBottom: '10px', paddingLeft: '20px' }}>
              <p><strong>{comp.address}</strong> - ${comp.price?.toLocaleString()} ({comp.sqft} sqft)</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
