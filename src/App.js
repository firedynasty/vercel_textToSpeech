import React, { useState, useEffect } from 'react';

const TextToSpeechComponent = () => {
  const [selectedLanguage, setSelectedLanguage] = useState('en-US');
  const [speechRate, setSpeechRate] = useState(1);
  const [availableVoices, setAvailableVoices] = useState([]);
  const [lastUsedVoice, setLastUsedVoice] = useState('None selected yet');
  // State for textarea and sentences
  const [textareaContent, setTextareaContent] = useState('');
  const [sentences, setSentences] = useState([]);
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(-1);

  // Sidebar and file management state
  const [files, setFiles] = useState({});
  const [selectedFile, setSelectedFile] = useState(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [editingFileName, setEditingFileName] = useState(null);
  const [newFileName, setNewFileName] = useState('');

  // Check if running on localhost
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

  // Auto-authenticate on localhost
  useEffect(() => {
    if (isLocalhost) {
      setIsAuthenticated(true);
      setAccessCode('localhost');
    }
  }, [isLocalhost]);

  // Load files on mount
  useEffect(() => {
    loadFiles();
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

  // Load files from API or localStorage
  const loadFiles = async () => {
    try {
      if (isLocalhost) {
        const storedFiles = localStorage.getItem('tts-files');
        const localFiles = storedFiles ? JSON.parse(storedFiles) : {};
        setFiles(localFiles);
      } else {
        const response = await fetch('/api/files');
        if (response.ok) {
          const data = await response.json();
          setFiles(data.files || {});
        }
      }
    } catch (err) {
      console.error('Error loading files:', err);
    }
  };

  // Unlock with access code
  const unlockAccess = async () => {
    if (!passwordInput.trim()) return;

    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessCode: passwordInput }),
      });

      if (response.ok) {
        setAccessCode(passwordInput);
        setIsAuthenticated(true);
        setPasswordInput('');
      } else {
        alert('Invalid access code');
        setPasswordInput('');
      }
    } catch (err) {
      alert('Error validating access code');
      setPasswordInput('');
    }
  };

  // Create new file
  const createNewFile = () => {
    if (!isLocalhost && !isAuthenticated) {
      alert('Please unlock first using the access code');
      return;
    }

    const filename = prompt('Enter filename (e.g., lesson1.txt):');
    if (!filename) return;

    let finalName = filename;
    if (!finalName.includes('.')) {
      finalName += '.txt';
    }

    if (files[finalName]) {
      alert('File already exists!');
      return;
    }

    const newFiles = { ...files, [finalName]: '' };
    setFiles(newFiles);
    if (isLocalhost) {
      localStorage.setItem('tts-files', JSON.stringify(newFiles));
    }
    setSelectedFile(finalName);
    setTextareaContent('');
    processTextIntoSentences('');
  };

  // Select a file
  const selectFile = (filename) => {
    setSelectedFile(filename);
    const content = files[filename] || '';
    setTextareaContent(content);
    processTextIntoSentences(content);
  };

  // Save current file
  const saveCurrentFile = async () => {
    if (!selectedFile) {
      // Save as new file
      const filename = prompt('Enter filename (e.g., lesson1.txt):');
      if (!filename) return;

      let finalName = filename;
      if (!finalName.includes('.')) {
        finalName += '.txt';
      }

      setSelectedFile(finalName);
      await saveFile(finalName, textareaContent);
    } else {
      await saveFile(selectedFile, textareaContent);
    }
  };

  // Save file to API or localStorage
  const saveFile = async (filename, content) => {
    if (!isLocalhost && !accessCode) {
      alert('Please unlock first');
      return;
    }

    setIsSaving(true);
    try {
      if (isLocalhost) {
        const newFiles = { ...files, [filename]: content };
        localStorage.setItem('tts-files', JSON.stringify(newFiles));
        setFiles(newFiles);
        alert('File saved locally!');
      } else {
        const response = await fetch('/api/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: filename,
            content: content,
            accessCode: accessCode,
          }),
        });

        if (response.ok) {
          setFiles(prev => ({ ...prev, [filename]: content }));
          alert('File saved!');
        } else {
          const data = await response.json();
          alert('Error saving: ' + (data.error || 'Unknown error'));
        }
      }
    } catch (err) {
      console.error('Error saving file:', err);
      alert('Error saving file');
    } finally {
      setIsSaving(false);
    }
  };

  // Delete file
  const deleteFile = async (filename) => {
    if (!window.confirm(`Delete "${filename}"?`)) return;

    if (!isLocalhost && !accessCode) {
      alert('Please unlock first');
      return;
    }

    try {
      if (isLocalhost) {
        const newFiles = { ...files };
        delete newFiles[filename];
        localStorage.setItem('tts-files', JSON.stringify(newFiles));
        setFiles(newFiles);
        if (selectedFile === filename) {
          setSelectedFile(null);
          setTextareaContent('');
          processTextIntoSentences('');
        }
      } else {
        const response = await fetch(`/api/files?filename=${encodeURIComponent(filename)}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessCode: accessCode }),
        });

        if (response.ok) {
          const newFiles = { ...files };
          delete newFiles[filename];
          setFiles(newFiles);
          if (selectedFile === filename) {
            setSelectedFile(null);
            setTextareaContent('');
            processTextIntoSentences('');
          }
        } else {
          alert('Error deleting file');
        }
      }
    } catch (err) {
      console.error('Error deleting file:', err);
      alert('Error deleting file');
    }
  };

  // Rename file
  const startRenameFile = (filename) => {
    setEditingFileName(filename);
    setNewFileName(filename);
  };

  const cancelRename = () => {
    setEditingFileName(null);
    setNewFileName('');
  };

  const confirmRename = async () => {
    if (!newFileName || newFileName === editingFileName) {
      cancelRename();
      return;
    }

    if (files[newFileName]) {
      alert('A file with this name already exists!');
      return;
    }

    const content = files[editingFileName];

    // Delete old file and create new one
    if (isLocalhost) {
      const newFiles = { ...files };
      delete newFiles[editingFileName];
      newFiles[newFileName] = content;
      localStorage.setItem('tts-files', JSON.stringify(newFiles));
      setFiles(newFiles);
      if (selectedFile === editingFileName) {
        setSelectedFile(newFileName);
      }
    } else {
      // Save new file
      await saveFile(newFileName, content);
      // Delete old file
      await deleteFile(editingFileName);
    }

    cancelRename();
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

    setCurrentSentenceIndex(index);

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

    speechSynthesis.speak(utterance);
  };

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', margin: 0, padding: 0, display: 'flex', height: '100vh' }}>
      {/* Sidebar */}
      {showSidebar && (
        <div style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '250px',
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid #333',
          zIndex: 100,
          background: '#1a1a2e'
        }}>
          <div style={{
            padding: '15px 10px',
            fontSize: '14px',
            fontWeight: 'bold',
            borderBottom: '1px solid #333',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: '#0d0d1a',
            color: '#4da6ff'
          }}>
            <span>DOCUMENTS</span>
            <button
              onClick={() => setShowSidebar(false)}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '5px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'inherit'
              }}
            >
              ✕
            </button>
          </div>

          {/* Unlock section (if not authenticated and not localhost) */}
          {!isAuthenticated && !isLocalhost && (
            <div style={{ padding: '10px', borderBottom: '1px solid #333' }}>
              <input
                type="password"
                placeholder="Access code..."
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && unlockAccess()}
                style={{
                  width: '100%',
                  padding: '8px',
                  marginBottom: '5px',
                  border: '1px solid #333',
                  borderRadius: '4px',
                  background: '#2c2c3e',
                  color: 'white',
                  boxSizing: 'border-box'
                }}
              />
              <button
                onClick={unlockAccess}
                style={{
                  width: '100%',
                  padding: '8px',
                  background: '#3B82F6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                Unlock
              </button>
            </div>
          )}

          <button
            onClick={createNewFile}
            style={{
              margin: '10px',
              padding: '12px 16px',
              background: '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: 'bold',
              cursor: 'pointer'
            }}
          >
            + New File
          </button>

          <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
            {Object.keys(files).length === 0 ? (
              <div style={{ padding: '20px', color: '#888' }}>No files yet</div>
            ) : (
              Object.keys(files).sort().map(filename => (
                <div
                  key={filename}
                  style={{
                    marginBottom: '8px',
                    padding: '10px',
                    background: selectedFile === filename ? '#3B82F6' : '#2c2c3e',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    color: 'white'
                  }}
                >
                  {editingFileName === filename ? (
                    <div style={{ display: 'flex', gap: '4px', flex: 1 }}>
                      <input
                        type="text"
                        value={newFileName}
                        onChange={(e) => setNewFileName(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && confirmRename()}
                        style={{
                          flex: 1,
                          padding: '4px',
                          background: '#1a1a2e',
                          border: '1px solid #444',
                          borderRadius: '3px',
                          color: 'white',
                          fontSize: '12px'
                        }}
                        autoFocus
                      />
                      <button
                        onClick={confirmRename}
                        style={{
                          padding: '4px 8px',
                          background: '#4CAF50',
                          color: 'white',
                          border: 'none',
                          borderRadius: '3px',
                          cursor: 'pointer',
                          fontSize: '11px'
                        }}
                      >
                        ✓
                      </button>
                      <button
                        onClick={cancelRename}
                        style={{
                          padding: '4px 8px',
                          background: '#666',
                          color: 'white',
                          border: 'none',
                          borderRadius: '3px',
                          cursor: 'pointer',
                          fontSize: '11px'
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <>
                      <span
                        onClick={() => selectFile(filename)}
                        style={{
                          flex: 1,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontSize: '13px'
                        }}
                      >
                        {filename}
                      </span>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            startRenameFile(filename);
                          }}
                          title="Edit name"
                          style={{
                            padding: '4px 8px',
                            border: 'none',
                            borderRadius: '4px',
                            background: '#2196F3',
                            color: 'white',
                            cursor: 'pointer',
                            fontSize: '12px'
                          }}
                        >
                          ✏️
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteFile(filename);
                          }}
                          title="Delete entry"
                          style={{
                            padding: '4px 8px',
                            border: 'none',
                            borderRadius: '4px',
                            background: '#f44336',
                            color: 'white',
                            cursor: 'pointer',
                            fontSize: '12px'
                          }}
                        >
                          🗑️
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>

          <button
            onClick={loadFiles}
            style={{
              margin: '10px',
              padding: '10px 16px',
              background: '#2196F3',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '13px',
              cursor: 'pointer'
            }}
          >
            Refresh
          </button>
        </div>
      )}

      {/* Main content */}
      <div style={{ flex: 1, padding: '1rem', overflowY: 'auto', marginLeft: showSidebar ? '250px' : '0' }}>
        {/* Toggle Sidebar Button */}
        <button
          onClick={() => setShowSidebar(!showSidebar)}
          style={{
            marginBottom: '1rem',
            padding: '8px 16px',
            background: '#2196F3',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px'
          }}
        >
          {showSidebar ? '← Hide Files' : '→ Show Files'}
        </button>

        {/* Current file indicator */}
        {selectedFile && (
          <div style={{ marginBottom: '1rem', fontSize: '14px', color: '#666' }}>
            <strong>Current file:</strong> {selectedFile}
          </div>
        )}

        <h1>React TTS Component - Multi-Language Test</h1>

        {/* Text Input Section */}
      <div style={{ marginBottom: '2rem', padding: '1rem', border: '2px solid #3B82F6', borderRadius: '0.5rem', backgroundColor: '#f0f9ff' }}>
        <h2 style={{ marginTop: 0, color: '#1e40af' }}>Text-to-Speech Reader</h2>

        <div style={{ marginBottom: '1rem' }}>
          <textarea
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
            onClick={saveCurrentFile}
            disabled={isSaving}
            style={{
              padding: '0.5rem 1rem',
              color: 'white',
              backgroundColor: isSaving ? '#666' : '#3B82F6',
              border: 'none',
              borderRadius: '0.25rem',
              cursor: isSaving ? 'not-allowed' : 'pointer',
              fontSize: '1rem',
              fontWeight: '600'
            }}
          >
            {isSaving ? 'Saving...' : '💾 Save File'}
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
                  onMouseEnter={(e) => {
                    if (currentSentenceIndex !== index) {
                      e.currentTarget.style.backgroundColor = '#e9ecef';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (currentSentenceIndex !== index) {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }
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