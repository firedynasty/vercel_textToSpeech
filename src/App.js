import React, { useState, useEffect, useRef } from 'react';

const TextToSpeechComponent = () => {
  const [selectedLanguage, setSelectedLanguage] = useState('en-US');
  const [speechRate, setSpeechRate] = useState(1);
  const [availableVoices, setAvailableVoices] = useState([]);
  const [lastUsedVoice, setLastUsedVoice] = useState('None selected yet');
  // State for textarea and sentences
  const [textareaContent, setTextareaContent] = useState('');
  const [sentences, setSentences] = useState([]);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(-1);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const autoAdvanceRef = useRef(true);
  autoAdvanceRef.current = autoAdvance;
  const sentencesRef = useRef([]);
  sentencesRef.current = sentences;
  const speakSentenceRef = useRef(null);
  const textareaRef = useRef(null);
  const currentSentenceIndexRef = useRef(-1);
  currentSentenceIndexRef.current = currentSentenceIndex;
  const sidebarEnteredRef = useRef(false);

  // Check if running on localhost
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  // Auto-load on mount
  useEffect(() => {
    loadFromBlob();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Load content from cloud or localStorage
  const loadFromBlob = async () => {
    setIsLoading(true);
    try {
      if (isLocalhost) {
        const stored = localStorage.getItem('tts-content');
        if (stored) {
          setTextareaContent(stored);
          processTextIntoSentences(stored);
        }
      } else {
        const response = await fetch('/api/files');
        if (response.ok) {
          const data = await response.json();
          const content = (data.files || {})['content.txt'];
          if (content) {
            setTextareaContent(content);
            processTextIntoSentences(content);
          }
        }
      }
    } catch (err) {
      console.error('Load error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Save content to cloud or localStorage
  const saveToBlob = async () => {
    setIsSaving(true);
    try {
      if (isLocalhost) {
        localStorage.setItem('tts-content', textareaContent);
        alert('Saved locally!');
      } else {
        const response = await fetch('/api/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: 'content.txt',
            content: textareaContent,
            accessCode: '123',
          }),
        });

        if (response.ok) {
          alert('Saved to cloud!');
        } else {
          const data = await response.json();
          alert('Error saving: ' + (data.error || 'Unknown error'));
        }
      }
    } catch (err) {
      console.error('Save error:', err);
      alert('Error saving');
    } finally {
      setIsSaving(false);
    }
  };

  // Process textarea text into sentences
  const processTextIntoSentences = (text) => {
    if (!text || !text.trim()) {
      setSentences([]);
      return;
    }

    // Split by sentence endings (., !, ?)
    const allRawSentences = text.split(/[.!?]+/).filter(sentence => sentence.trim().length > 0);

    // Consolidate short sentences (< 15 characters)
    const consolidatedSentences = [];
    for (let i = 0; i < allRawSentences.length; i++) {
      const currentSentence = allRawSentences[i].trim();
      if (!currentSentence) continue;

      const charLength = currentSentence.length;

      // If sentence is very short, merge with previous or next
      if (charLength < 15 && consolidatedSentences.length > 0) {
        const lastIndex = consolidatedSentences.length - 1;
        consolidatedSentences[lastIndex] = consolidatedSentences[lastIndex] + '. ' + currentSentence;
      } else if (charLength < 15 && i < allRawSentences.length - 1) {
        const nextSentence = allRawSentences[i + 1].trim();
        if (nextSentence) {
          consolidatedSentences.push(currentSentence + '. ' + nextSentence);
          i++;
        } else {
          consolidatedSentences.push(currentSentence);
        }
      } else {
        consolidatedSentences.push(currentSentence);
      }
    }

    setSentences(consolidatedSentences);
    setCurrentSentenceIndex(-1);
  };

  // Paste from clipboard
  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setTextareaContent(text);
      processTextIntoSentences(text);
      // Scroll back up to the textarea
      if (textareaRef.current) {
        textareaRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch (err) {
      console.error('Failed to read clipboard:', err);
      alert('Failed to read from clipboard. Please paste manually or check permissions.');
    }
  };

  // Append clipboard to existing textarea content
  const handleAppendFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const combined = textareaContent + (textareaContent ? '\n' : '') + text;
      setTextareaContent(combined);
      processTextIntoSentences(combined);
    } catch (err) {
      console.error('Failed to read clipboard:', err);
      alert('Failed to read from clipboard. Please paste manually or check permissions.');
    }
  };

  // Handle textarea change
  const handleTextareaChange = (e) => {
    const text = e.target.value;
    setTextareaContent(text);
    processTextIntoSentences(text);
  };

  // Speak a sentence
  const speakSentence = (sentenceText, index) => {
    if (!sentenceText) return;

    console.log(`[speakSentence] called with index=${index}, text="${sentenceText.substring(0, 50)}..."`);

    // Cancel any current/queued speech immediately
    speechSynthesis.cancel();

    setCurrentSentenceIndex(index);
    console.log(`[speakSentence] setCurrentSentenceIndex(${index})`);

    const utterance = new SpeechSynthesisUtterance(sentenceText);
    utterance.lang = selectedLanguage;
    utterance.rate = speechRate;

    const voices = availableVoices;

    // Use the same voice selection logic as speakText
    if (selectedLanguage.includes('en-')) {
      let englishVoice = voices.find(voice =>
        (voice.lang.includes('en-') && voice.name.includes('Enhanced')) ||
        (voice.lang.includes('en-') && voice.name.includes('Premium'))
      );

      if (!englishVoice) {
        englishVoice = voices.find(voice =>
          voice.lang.includes('en-') && voice.name.includes('Google')
        );
      }

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

      if (!englishVoice) {
        englishVoice = voices.find(voice => voice.lang.includes('en-'));
      }

      if (englishVoice) {
        setLastUsedVoice(`${englishVoice.name} (${englishVoice.lang})`);
        utterance.voice = englishVoice;
      }
    } else if ((selectedLanguage === 'zh-CN' || selectedLanguage === 'zh-HK')) {
      if (selectedLanguage === 'zh-CN') {
        let chineseVoice;
        const blacklistedVoices = ['Eddy', 'Flo', 'Grandma', 'Grandpa'];

        chineseVoice = voices.find(voice =>
          voice.name.includes('Google') && voice.lang.includes('zh-CN') &&
          !blacklistedVoices.some(bad => voice.name.includes(bad)));

        if (!chineseVoice) {
          chineseVoice = voices.find(voice =>
            voice.lang.includes('zh-CN') &&
            (voice.name.includes('Enhanced') || voice.name.includes('Premium')) &&
            !blacklistedVoices.some(bad => voice.name.includes(bad)));
        }

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

        if (!chineseVoice) {
          chineseVoice = voices.find(voice =>
            voice.lang.includes('zh-CN') &&
            !blacklistedVoices.some(bad => voice.name.includes(bad)));
        }

        if (!chineseVoice) {
          chineseVoice = voices.find(voice => voice.lang.includes('zh-CN'));
        }

        if (chineseVoice) {
          setLastUsedVoice(`${chineseVoice.name} (${chineseVoice.lang})`);
          utterance.voice = chineseVoice;
        }
      } else if (selectedLanguage === 'zh-HK') {
        let cantoneseVoice;

        cantoneseVoice = voices.find(voice =>
          voice.name.includes('Google') && voice.lang.includes('zh-HK'));

        if (!cantoneseVoice) {
          cantoneseVoice = voices.find(voice =>
            voice.lang.includes('zh-HK') && (voice.name.includes('Enhanced') || voice.name.includes('Premium')));
        }

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

        if (!cantoneseVoice) {
          cantoneseVoice = voices.find(voice => voice.lang.includes('zh-HK'));
        }

        if (cantoneseVoice) {
          setLastUsedVoice(`${cantoneseVoice.name} (${cantoneseVoice.lang})`);
          utterance.voice = cantoneseVoice;
        }
      }
    } else if (selectedLanguage === 'ko-KR') {
      const koreanVoice = voices.find(voice => voice.name === 'Google 한국의');
      if (koreanVoice) {
        setLastUsedVoice(`${koreanVoice.name} (${koreanVoice.lang})`);
        utterance.voice = koreanVoice;
      }
    } else if (selectedLanguage === 'fr-FR') {
      let frenchVoice;

      frenchVoice = voices.find(voice =>
        voice.name.includes('Google') && voice.lang.includes('fr'));

      if (!frenchVoice) {
        frenchVoice = voices.find(voice =>
          voice.lang.includes('fr') && (voice.name.includes('Enhanced') || voice.name.includes('Premium')));
      }

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

      if (!frenchVoice) {
        frenchVoice = voices.find(voice => voice.lang.includes('fr'));
      }

      if (frenchVoice) {
        setLastUsedVoice(`${frenchVoice.name} (${frenchVoice.lang})`);
        utterance.voice = frenchVoice;
      }
    } else if (selectedLanguage === 'es-ES') {
      const spanishVoice = voices.find(voice =>
        voice.lang.includes('es-') && (voice.name.includes('Google') || voice.name.includes('Enhanced'))
      );
      if (spanishVoice) {
        setLastUsedVoice(`${spanishVoice.name} (${spanishVoice.lang})`);
        utterance.voice = spanishVoice;
      }
    } else if (selectedLanguage === 'he-IL') {
      let hebrewVoice;

      hebrewVoice = voices.find(voice =>
        voice.name.includes('Google') && voice.lang.includes('he'));

      if (!hebrewVoice) {
        hebrewVoice = voices.find(voice =>
          voice.lang.includes('he') && (voice.name.includes('Enhanced') || voice.name.includes('Premium')));
      }

      if (!hebrewVoice) {
        const goodHebrewNames = ['Asaf', 'Carmit', 'Microsoft Asaf', 'Microsoft Carmit', 'Zohar', 'Lior', 'Hebrew', 'Apple Hebrew', 'Siri Hebrew'];
        for (const name of goodHebrewNames) {
          const foundVoice = voices.find(voice =>
            voice.lang.includes('he') && voice.name.includes(name));
          if (foundVoice) {
            hebrewVoice = foundVoice;
            break;
          }
        }
      }

      if (!hebrewVoice) {
        hebrewVoice = voices.find(voice => voice.lang.includes('he'));
      }

      if (hebrewVoice) {
        setLastUsedVoice(`${hebrewVoice.name} (${hebrewVoice.lang})`);
        utterance.voice = hebrewVoice;
      }
    }

    utterance.onend = () => {
      console.log(`[onend] finished index=${index}, autoAdvance=${autoAdvanceRef.current}`);
      if (autoAdvanceRef.current) {
        const nextIndex = index + 1;
        console.log(`[onend] advancing to nextIndex=${nextIndex}, total=${sentencesRef.current.length}`);
        if (nextIndex < sentencesRef.current.length) {
          setTimeout(() => {
            speakSentenceRef.current(sentencesRef.current[nextIndex], nextIndex);
          }, 300);
        }
      }
    };

    speechSynthesis.speak(utterance);
  };
  speakSentenceRef.current = speakSentence;

  console.log(`[render] currentSentenceIndex=${currentSentenceIndex}, sentences.length=${sentences.length}`);

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', margin: 0, padding: 0, display: 'flex', height: '100vh' }}>
      {/* Left sidebar - hover to resume reading from last highlighted sentence */}
      {sentences.length > 0 && (
        <div
          onMouseEnter={() => {
            if (sidebarEnteredRef.current) return;
            sidebarEnteredRef.current = true;
            const idx = currentSentenceIndexRef.current >= 0 ? currentSentenceIndexRef.current : 0;
            console.log(`[sidebar hover] ENTER, starting from idx=${idx}`);
            speakSentence(sentencesRef.current[idx], idx);
          }}
          onMouseLeave={() => {
            console.log(`[sidebar hover] LEAVE`);
            sidebarEnteredRef.current = false;
          }}
          style={{
            width: '50px',
            minWidth: '50px',
            height: '100vh',
            backgroundColor: '#e0e0e0',
            borderRight: '2px solid #ccc',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px',
            userSelect: 'none'
          }}
        >
          <div style={{ fontSize: '18px' }}>▶</div>
          <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#333' }}>
            {currentSentenceIndex >= 0 ? currentSentenceIndex + 1 : '—'}
          </div>
          <div style={{ fontSize: '10px', color: '#666' }}>
            / {sentences.length}
          </div>
        </div>
      )}

      {/* Main content */}
      <div style={{ flex: 1, padding: '1rem', overflowY: 'auto' }}>
        <h1>React TTS Component - Multi-Language Test</h1>

        {/* Text Input Section */}
      <div style={{ marginBottom: '2rem', padding: '1rem', border: '2px solid #3B82F6', borderRadius: '0.5rem', backgroundColor: '#f0f9ff' }}>
        <h2 style={{ marginTop: 0, color: '#1e40af' }}>Text-to-Speech Reader</h2>

        <div style={{ marginBottom: '1rem' }}>
          <textarea
            ref={textareaRef}
            placeholder="Paste your text here or click 'Paste from Clipboard' to automatically get clipboard content..."
            value={textareaContent}
            onChange={handleTextareaChange}
            style={{
              width: '100%',
              minHeight: '120px',
              padding: '0.75rem',
              border: '1px solid #ccc',
              borderRadius: '0.25rem',
              fontFamily: 'inherit',
              fontSize: '1rem',
              resize: 'vertical',
              boxSizing: 'border-box'
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            onClick={handlePasteFromClipboard}
            style={{
              padding: '0.5rem 1rem',
              color: 'white',
              backgroundColor: '#10B981',
              border: 'none',
              borderRadius: '0.25rem',
              cursor: 'pointer',
              fontSize: '1rem',
              fontWeight: '600'
            }}
          >
            Paste from Clipboard
          </button>

          <button
            onClick={handleAppendFromClipboard}
            style={{
              padding: '0.5rem 1rem',
              color: 'white',
              backgroundColor: '#F59E0B',
              border: 'none',
              borderRadius: '0.25rem',
              cursor: 'pointer',
              fontSize: '1rem',
              fontWeight: '600'
            }}
          >
            Append
          </button>

          <button
            onClick={loadFromBlob}
            disabled={isLoading}
            style={{
              padding: '8px 16px',
              background: 'rgba(76, 175, 80, 0.3)',
              border: 'none',
              borderRadius: '6px',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              fontWeight: 'bold',
              color: 'white',
              fontSize: '1rem'
            }}
          >
            {isLoading ? 'Loading...' : 'Load'}
          </button>

          <button
            onClick={saveToBlob}
            disabled={isSaving}
            style={{
              padding: '8px 16px',
              background: 'rgba(76, 175, 80, 0.3)',
              border: 'none',
              borderRadius: '6px',
              cursor: isSaving ? 'not-allowed' : 'pointer',
              fontWeight: 'bold',
              color: 'white',
              fontSize: '1rem'
            }}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>

        {/* Auto-advance toggle - sticky navbar */}
        <div style={{ position: 'sticky', top: 0, zIndex: 100, display: 'flex', alignItems: 'center', gap: '10px', marginTop: '0.75rem', padding: '8px 12px', backgroundColor: autoAdvance ? '#e6ffe6' : '#f0f0f0', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <span
            onMouseEnter={() => { console.log('[navbar] Stop After Line hovered → autoAdvance=false'); setAutoAdvance(false); }}
            style={{ fontWeight: 'bold', fontSize: '12px', color: '#666', cursor: 'pointer', padding: '4px 8px', borderRadius: '4px', backgroundColor: !autoAdvance ? '#ffcdd2' : 'transparent' }}
          >Stop After Line</span>
          <label style={{ position: 'relative', display: 'inline-block', width: '50px', height: '24px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={autoAdvance}
              onChange={(e) => setAutoAdvance(e.target.checked)}
              style={{ opacity: 0, width: 0, height: 0 }}
            />
            <span style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: autoAdvance ? '#4CAF50' : '#ddd',
              transition: '.4s', borderRadius: '24px'
            }}>
              <span style={{
                position: 'absolute', content: '""',
                height: '18px', width: '18px',
                left: autoAdvance ? '29px' : '3px',
                bottom: '3px',
                backgroundColor: 'white',
                transition: '.4s', borderRadius: '50%',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)'
              }} />
            </span>
          </label>
          <span
            onMouseEnter={() => setAutoAdvance(true)}
            style={{ fontWeight: 'bold', fontSize: '12px', color: autoAdvance ? '#4CAF50' : '#666', cursor: 'pointer', padding: '4px 8px', borderRadius: '4px', backgroundColor: autoAdvance ? '#c8e6c9' : 'transparent' }}
          >Auto Next Line</span>

          <button
            onClick={handlePasteFromClipboard}
            style={{
              marginLeft: 'auto',
              padding: '4px 12px',
              color: 'white',
              backgroundColor: '#10B981',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: '600'
            }}
          >
            Paste from Clipboard
          </button>
        </div>

        {/* Reading Area - Clickable Sentence Divs */}
        {sentences.length > 0 && (
          <div style={{ marginTop: '1.5rem' }}>
            <h3 style={{ color: '#1e40af' }}>Click any sentence to read it aloud:</h3>
            <div style={{
              backgroundColor: '#f8f9fa',
              border: '2px solid #dee2e6',
              borderRadius: '0.5rem',
              padding: '1.5rem',
              minHeight: '200px',
              fontSize: '1.1rem',
              lineHeight: '1.8'
            }}>
              {sentences.map((sentence, index) => (
                <div
                  key={index}
                  onClick={() => speakSentence(sentence, index)}
                  style={{
                    padding: '0.75rem',
                    marginBottom: '0.5rem',
                    cursor: 'pointer',
                    borderRadius: '0.25rem',
                    backgroundColor: currentSentenceIndex === index ? '#ffd43b' : 'transparent',
                    transition: 'background-color 0.2s',
                    fontWeight: currentSentenceIndex === index ? 'bold' : 'normal',
                    boxShadow: currentSentenceIndex === index ? '0 0 5px rgba(255, 212, 59, 0.5)' : 'none'
                  }}
                  onMouseEnter={() => {
                    console.log(`[sentence hover] marking index=${index}`);
                    setCurrentSentenceIndex(index);
                  }}
                >
                  {sentence}.
                </div>
              ))}
            </div>
            <p style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: '#666' }}>
              {sentences.length} sentences detected
            </p>
          </div>
        )}
      </div>

      {/* Controls */}
      <div style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>

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
          <option value="he-IL">Hebrew</option>
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

        {/* Debug Info */}
        <div style={{ marginTop: '1rem', fontSize: '0.8rem', color: '#666' }}>
          <p>Available voices: {availableVoices.length}</p>
          <p>Current language: {selectedLanguage}</p>
          <p>Speech rate: {speechRate}x</p>
          <p><strong>Last Used Voice:</strong> <span style={{color: '#2563eb', fontWeight: 'bold'}}>{lastUsedVoice}</span></p>
        </div>
      </div>
    </div>
  );
};

export default TextToSpeechComponent;