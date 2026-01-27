import React, { useState, useEffect } from 'react';

const TextToSpeechComponent = () => {
  const [selectedLanguage, setSelectedLanguage] = useState('zh-HK');
  const [speechRate, setSpeechRate] = useState(0.7);
  const [availableVoices, setAvailableVoices] = useState([]);
  const [lastUsedVoice, setLastUsedVoice] = useState('None selected yet');
  const [tableData, setTableData] = useState([
    ['1', '你好', 'Hello'],
    ['1', '再見', 'Goodbye'],
    ['1', '謝謝', 'Thank you'],
    ['1', '你好嗎？', 'How are you?'],
    ['1', '早晨', 'Good morning'],
    ['1', 'Mucho gusto', 'Nice to meet you'],
    ['1', 'Por favor', 'Please'],
    ['1', 'Con permiso', 'Excuse me'],
    ['1', 'Hasta luego', 'See you later'],
    ['1', '¿Cómo te llamas?', 'What is your name?'],
    ['1', 'Bonsoir', 'Good evening'],
    ['1', 'Oui', 'Yes'],
    ['1', 'Non', 'No'],
    ['1', 'Où sont les toilettes?', 'Where is the bathroom?'],
    ['1', 'Je t\'aime', 'I love you'],
    ['1', '好運', 'Good luck'],
    ['1', '美麗', 'Beautiful'],
    ['1', '家庭', 'Family'],
    ['1', '朋友', 'Friend'],
    ['1', '水', 'Water']
  ]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [displayTextMain, setDisplayTextMain] = useState('你好');
  const [displayTextSub, setDisplayTextSub] = useState('Hello');

  // Load available voices when component mounts
  useEffect(() => {
    const loadVoices = () => {
      const voices = speechSynthesis.getVoices();
      setAvailableVoices(voices);
      console.log("Available voices:", voices.map(v => `${v.name} (${v.lang})`).join(', '));
    };

    // Load voices immediately if available
    loadVoices();
    
    // Also listen for voiceschanged event
    speechSynthesis.addEventListener('voiceschanged', loadVoices);
    
    return () => {
      speechSynthesis.removeEventListener('voiceschanged', loadVoices);
    };
  }, []);

  // Initialize display with first row
  useEffect(() => {
    if (tableData.length > 0) {
      setDisplayTextMain(tableData[0][1] || '');
      setDisplayTextSub(tableData[0][2] || '');
    }
  }, [tableData]);

  // Main TTS function - exact replica from your code
  const speakText = (text, cellIndex) => {
    if (!text) return;
    
    // Don't truncate at colon, speak the entire text
    let textToSpeak = text;
    // Remove parentheses if they exist
    textToSpeak = textToSpeak.replace(/[()]/g, '').trim();
    
    const utterance = new SpeechSynthesisUtterance(textToSpeak);
    
    // For first column text (left side), use the selected language
    // For second column text (right side), always use English
    utterance.lang = cellIndex === 2 ? 'en-US' : selectedLanguage;
    utterance.rate = speechRate;
    
    const voices = availableVoices;
    
    // Handle voice selection for English and other languages
    if (cellIndex === 2 || utterance.lang.includes('en-')) {
      // Try to find a high-quality English voice in this order:
      // 1. Premium voices (often have "Enhanced" in the name)
      // 2. Google voices (generally high quality)
      // 3. System voices with specific names known for clarity
      // 4. Any en-US or en-GB voice

      // Look for premium enhanced voices first
      let englishVoice = voices.find(voice =>
        (voice.lang.includes('en-') && voice.name.includes('Enhanced')) ||
        (voice.lang.includes('en-') && voice.name.includes('Premium'))
      );

      // If no enhanced voice, try Google voices
      if (!englishVoice) {
        englishVoice = voices.find(voice =>
          voice.lang.includes('en-') && voice.name.includes('Google')
        );
      }

      // If no Google voice, try specific known high-quality voices
      if (!englishVoice) {
        const qualityVoiceNames = ['Daniel', 'Samantha', 'Alex', 'Karen', 'Microsoft David'];
        for (const name of qualityVoiceNames) {
          const foundVoice = voices.find(voice =>
            voice.lang.includes('en-') && voice.name.includes(name)
          );
          if (foundVoice) {
            englishVoice = foundVoice;
            break;
          }
        }
      }

      // If still no voice, just get any English voice
      if (!englishVoice) {
        englishVoice = voices.find(voice => voice.lang.includes('en-'));
      }

      if (englishVoice) {
        console.log(`Using English voice: ${englishVoice.name} (${englishVoice.lang})`);
        setLastUsedVoice(`${englishVoice.name} (${englishVoice.lang})`);
        utterance.voice = englishVoice;
      }
    }
    // Handle Chinese voices with better selection
    else if ((selectedLanguage === 'zh-CN' || selectedLanguage === 'zh-HK') && cellIndex !== 2) {
      // For Mandarin (zh-CN)
      if (selectedLanguage === 'zh-CN') {
        // Try to find the best Mandarin voice in order of preference
        let chineseVoice;
        
        // Blacklist of known problematic voices
        const blacklistedVoices = ['Eddy', 'Flo', 'Grandma', 'Grandpa'];
        
        // 1. Try Google voices first (usually highest quality)
        chineseVoice = voices.find(voice => 
          voice.name.includes('Google') && voice.lang.includes('zh-CN') && 
          !blacklistedVoices.some(bad => voice.name.includes(bad)));
        
        // 2. Try Enhanced/Premium voices (excluding blacklisted)
        if (!chineseVoice) {
          chineseVoice = voices.find(voice => 
            voice.lang.includes('zh-CN') && 
            (voice.name.includes('Enhanced') || voice.name.includes('Premium')) &&
            !blacklistedVoices.some(bad => voice.name.includes(bad)));
        }
        
        // 3. Try specific known good voices
        if (!chineseVoice) {
          const goodMandarinNames = ['Li-Mu', 'Ting-Ting', 'Sin-ji', 'Mei-Jia', 'Yaoyao', 'Kangkang', 'Huihui'];
          for (const name of goodMandarinNames) {
            const foundVoice = voices.find(voice => 
              voice.lang.includes('zh-CN') && voice.name.includes(name));
            if (foundVoice) {
              chineseVoice = foundVoice;
              break;
            }
          }
        }
        
        // 4. Fallback to any zh-CN voice (excluding blacklisted)
        if (!chineseVoice) {
          chineseVoice = voices.find(voice => 
            voice.lang.includes('zh-CN') && 
            !blacklistedVoices.some(bad => voice.name.includes(bad)));
        }
        
        // 5. Last resort: use any zh-CN voice (even blacklisted ones)
        if (!chineseVoice) {
          chineseVoice = voices.find(voice => voice.lang.includes('zh-CN'));
        }
        
        if (chineseVoice) {
          console.log(`Using Mandarin voice: ${chineseVoice.name} (${chineseVoice.lang})`);
          setLastUsedVoice(`${chineseVoice.name} (${chineseVoice.lang})`);
          utterance.voice = chineseVoice;
        }
      }
      // For Cantonese (zh-HK)
      else if (selectedLanguage === 'zh-HK') {
        let cantoneseVoice;
        
        // 1. Try Google Cantonese voices first
        cantoneseVoice = voices.find(voice => 
          voice.name.includes('Google') && voice.lang.includes('zh-HK'));
        
        // 2. Try Enhanced/Premium Cantonese voices
        if (!cantoneseVoice) {
          cantoneseVoice = voices.find(voice => 
            voice.lang.includes('zh-HK') && (voice.name.includes('Enhanced') || voice.name.includes('Premium')));
        }
        
        // 3. Try specific known good Cantonese voices
        if (!cantoneseVoice) {
          const goodCantoneseNames = ['Sin-ji', 'Hong Kong'];
          for (const name of goodCantoneseNames) {
            const foundVoice = voices.find(voice => 
              voice.lang.includes('zh-HK') && voice.name.includes(name));
            if (foundVoice) {
              cantoneseVoice = foundVoice;
              break;
            }
          }
        }
        
        // 4. Fallback to any zh-HK voice
        if (!cantoneseVoice) {
          cantoneseVoice = voices.find(voice => voice.lang.includes('zh-HK'));
        }
        
        if (cantoneseVoice) {
          console.log(`Using Cantonese voice: ${cantoneseVoice.name} (${cantoneseVoice.lang})`);
          setLastUsedVoice(`${cantoneseVoice.name} (${cantoneseVoice.lang})`);
          utterance.voice = cantoneseVoice;
        }
      }
    }
    
    // Handle Korean voice selection
    else if (selectedLanguage === 'ko-KR' && cellIndex !== 2) {
      const koreanVoice = voices.find(voice => voice.name === 'Google 한국의');
      if (koreanVoice) {
        setLastUsedVoice(`${koreanVoice.name} (${koreanVoice.lang})`);
        utterance.voice = koreanVoice;
      }
    }
    
    // Handle French voice selection with better detection
    else if (selectedLanguage === 'fr-FR' && cellIndex !== 2) {
      let frenchVoice;
      
      // 1. Try Google French voices first
      frenchVoice = voices.find(voice => 
        voice.name.includes('Google') && voice.lang.includes('fr'));
      
      // 2. Try Enhanced/Premium French voices
      if (!frenchVoice) {
        frenchVoice = voices.find(voice => 
          voice.lang.includes('fr') && (voice.name.includes('Enhanced') || voice.name.includes('Premium')));
      }
      
      // 3. Try specific known good French voices
      if (!frenchVoice) {
        const goodFrenchNames = ['Amelie', 'Thomas', 'Virginie', 'Audrey', 'Marie', 'Paul'];
        for (const name of goodFrenchNames) {
          const foundVoice = voices.find(voice => 
            voice.lang.includes('fr') && voice.name.includes(name));
          if (foundVoice) {
            frenchVoice = foundVoice;
            break;
          }
        }
      }
      
      // 4. Try any French voice (fr-FR, fr-CA, fr-BE, etc.)
      if (!frenchVoice) {
        frenchVoice = voices.find(voice => voice.lang.includes('fr'));
      }
      
      // 5. Debug: if still no voice, let's see what's available
      if (!frenchVoice) {
        console.log('No French voice found. Available voices:', voices.map(v => `${v.name} (${v.lang})`));
        setLastUsedVoice('No French voice available on this system');
      } else {
        setLastUsedVoice(`${frenchVoice.name} (${frenchVoice.lang})`);
        utterance.voice = frenchVoice;
      }
    }
    
    // Handle Spanish voice selection
    else if (selectedLanguage === 'es-ES' && cellIndex !== 2) {
      const spanishVoice = voices.find(voice => 
        voice.lang.includes('es-') && (voice.name.includes('Google') || voice.name.includes('Enhanced'))
      );
      if (spanishVoice) {
        setLastUsedVoice(`${spanishVoice.name} (${spanishVoice.lang})`);
        utterance.voice = spanishVoice;
      }
    }
    
    speechSynthesis.speak(utterance);
  };

  // Handle cell click - exact replica from your code
  const handleCellClick = (rowIndex, cellIndex, cell) => {
    setCurrentIndex(rowIndex);
    setDisplayTextMain(tableData[rowIndex][1] || '');
    setDisplayTextSub(tableData[rowIndex][2] || '');
    
    if (cellIndex === 0) {
      if (cell === '1' || cell === '2') {
        const newTableData = [...tableData];
        newTableData[rowIndex][cellIndex] = cell === '1' ? '2' : '1';
        setTableData(newTableData);
      }
    } else if (cellIndex === 1 || cellIndex === 2) {
      speakText(cell, cellIndex);
    }
  };

  // Handle navigation
  const handleNavigation = (direction) => {
    if (tableData.length === 0) return;

    let newIndex = currentIndex;
    const maxAttempts = tableData.length;
    let attempts = 0;

    do {
      if (direction === 'right') {
        newIndex = (newIndex + 1) % tableData.length;
      } else {
        newIndex = newIndex > 0 ? newIndex - 1 : tableData.length - 1;
      }
      attempts++;
      
      if (tableData[newIndex][0] === '1' || attempts >= maxAttempts) {
        break;
      }
    } while (newIndex !== currentIndex);

    if (tableData[newIndex][0] === '1' || attempts >= maxAttempts) {
      setCurrentIndex(newIndex);
      setDisplayTextMain(tableData[newIndex][1] || '');
      setDisplayTextSub(tableData[newIndex][2] || '');
    }
  };

  // Handle display box click
  const handleDisplayBoxClick = () => {
    const mainText = displayTextMain;
    
    // Always speak the text based on the selected language
    if (mainText) {
      // Use 1 as the cellIndex to use the selected language (not English)
      speakText(mainText, 1);
    }
  };

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', margin: 0, padding: '1rem' }}>
      <h1>React TTS Component - Multi-Language Test</h1>
      
      {/* Display Box */}
      <div 
        style={{
          marginBottom: '1rem',
          padding: '1rem',
          border: '1px solid #ccc',
          borderRadius: '0.25rem',
          backgroundColor: '#f8f9fa',
          cursor: 'pointer'
        }}
        onClick={handleDisplayBoxClick}
      >
        <div style={{ fontSize: '1.25rem', marginBottom: '0.5rem' }}>
          {displayTextMain}
        </div>
        <div style={{ fontSize: '1rem', color: '#666' }}>
          {displayTextSub}
        </div>
      </div>

      {/* Controls */}
      <div style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button 
          style={{ padding: '0.5rem 1rem', color: 'white', backgroundColor: '#4B5563', border: 'none', borderRadius: '0.25rem', cursor: 'pointer' }}
          onClick={() => handleNavigation('left')}
        >
          ← Left
        </button>
        <button 
          style={{ padding: '0.5rem 1rem', color: 'white', backgroundColor: '#4B5563', border: 'none', borderRadius: '0.25rem', cursor: 'pointer' }}
          onClick={() => handleNavigation('right')}
        >
          Right →
        </button>

        <select 
          id="languageSelect" 
          value={selectedLanguage} 
          onChange={(e) => setSelectedLanguage(e.target.value)}
          style={{ padding: '0.5rem', border: '1px solid #ccc', borderRadius: '0.25rem' }}
        >
          <option value="zh-HK">Cantonese</option>
          <option value="en-US">English</option>
          <option value="fr-FR">French</option>
          <option value="es-ES">Spanish</option>
          <option value="zh-CN">Mandarin</option>
          <option value="ko-KR">Korean</option>
        </select>

        <select 
          id="rateSelect" 
          value={speechRate} 
          onChange={(e) => setSpeechRate(parseFloat(e.target.value))}
          style={{ padding: '0.5rem', border: '1px solid #ccc', borderRadius: '0.25rem' }}
        >
          <option value="1">1x</option>
          <option value="1.5">1.5x</option>
          <option value="0.7">0.7x</option>
        </select>
      </div>
      
      {/* Table */}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {tableData.map((row, rowIndex) => (
            <tr 
              key={rowIndex}
              style={{ backgroundColor: rowIndex === currentIndex ? '#fef08a' : 'transparent' }}
            >
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  style={{
                    border: '1px solid #ccc',
                    padding: '0.5rem',
                    cursor: 'pointer'
                  }}
                  onClick={() => handleCellClick(rowIndex, cellIndex, cell)}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Debug Info */}
      <div style={{ marginTop: '1rem', fontSize: '0.8rem', color: '#666' }}>
        <p>Available voices: {availableVoices.length}</p>
        <p>Current language: {selectedLanguage}</p>
        <p>Speech rate: {speechRate}x</p>
        <p><strong>Last Used Voice:</strong> <span style={{color: '#2563eb', fontWeight: 'bold'}}>{lastUsedVoice}</span></p>
        <p><strong>Test Instructions:</strong></p>
        <ul>
          <li><strong>Column 1 (Mixed Languages):</strong> Speaks in selected language from dropdown</li>
          <li><strong>Column 2 (English):</strong> Always speaks in English regardless of dropdown</li>
          <li><strong>Chinese entries:</strong> 你好, 再見, 謝謝, 你好嗎？, 早晨, 好運, 美麗, 家庭, 朋友, 水</li>
          <li><strong>Spanish entries:</strong> Mucho gusto, Por favor, Con permiso, Hasta luego, ¿Cómo te llamas?</li>
          <li><strong>French entries:</strong> Bonsoir, Oui, Non, Où sont les toilettes?, Je t'aime</li>
          <li>Change language dropdown to test different TTS voices</li>
          <li>Click display box to speak main text in selected language</li>
        </ul>
      </div>
    </div>
  );
};

export default TextToSpeechComponent;
