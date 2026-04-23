import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Upload, ArrowRight, ArrowLeft, Play, Pause, Volume2, VolumeX, Speaker } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { Button } from './components/ui/button';
import { Slider } from './components/ui/slider';

const MediaReader = () => {
  const [files, setFiles] = useState({});
  const [currentTextFile, setCurrentTextFile] = useState('');
  const [currentMediaFile, setCurrentMediaFile] = useState('');
  const [currentPage, setCurrentPage] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [speakAfterAdvance, setSpeakAfterAdvance] = useState(false);
  const [ttsEngine, setTtsEngine] = useState(() => localStorage.getItem('mediaTtsEngine') || 'browser');
  const [openaiVoice, setOpenaiVoice] = useState(() => localStorage.getItem('mediaOpenaiVoice') || 'onyx');
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [apiKeyValue, setApiKeyValue] = useState(() => {
    const key = localStorage.getItem('OPENAI_API_KEY') || '';
    return key ? '••••' + key.slice(-4) : '';
  });
  const autoAdvanceRef = useRef(autoAdvance);
  autoAdvanceRef.current = autoAdvance;
  const ttsEngineRef = useRef(ttsEngine);
  ttsEngineRef.current = ttsEngine;
  const openaiVoiceRef = useRef(openaiVoice);
  openaiVoiceRef.current = openaiVoice;
  const videoRef = useRef(null);
  const currentAudioRef = useRef(null);

  // ... rest of the component remains the same ...
  const sortedFiles = useMemo(() => {
    const textFiles = [];
    const mediaFiles = [];
    
    Object.entries(files).forEach(([filename, file]) => {
      if (file.type === 'text') {
        textFiles.push(filename);
      } else {
        mediaFiles.push(filename);
      }
    });

    return {
      text: textFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
      media: mediaFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    };
  }, [files]);

  const handleFileUpload = async (event) => {
    const fileList = event.target.files;
    const newFiles = { ...files };
    const fileReadPromises = [];

    Array.from(fileList).forEach(file => {
      if (file.type === 'text/plain') {
        const promise = new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            newFiles[file.name] = {
              type: 'text',
              content: e.target.result
            };
            resolve();
          };
          reader.readAsText(file, 'UTF-8');
        });
        fileReadPromises.push(promise);
      } 
      else if (file.type.startsWith('image/') || file.type === 'video/mp4') {
        const promise = new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            newFiles[file.name] = {
              type: file.type.startsWith('image/') ? 'image' : 'video',
              content: [e.target.result]
            };
            resolve();
          };
          reader.readAsDataURL(file);
        });
        fileReadPromises.push(promise);
      }
    });

    await Promise.all(fileReadPromises);
    setFiles(newFiles);

    const textFiles = Object.entries(newFiles)
      .filter(([_, file]) => file.type === 'text')
      .map(([name]) => name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const mediaFiles = Object.entries(newFiles)
      .filter(([_, file]) => file.type === 'image' || file.type === 'video')
      .map(([name]) => name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (textFiles.length > 0 && !currentTextFile) {
      setCurrentTextFile(textFiles[0]);
      setCurrentPage(0);
    }

    if (mediaFiles.length > 0 && !currentMediaFile) {
      setCurrentMediaFile(mediaFiles[0]);
    }
  };

  const handleVideoTimeUpdate = (e) => {
    setCurrentTime(e.target.currentTime);
  };

  const handleVideoDurationChange = (e) => {
    setDuration(e.target.duration);
  };

  const handleVideoEnded = () => {
    setIsPlaying(false);
  };

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
      setIsMuted(!isMuted);
    }
  };

  const handleSeek = (value) => {
    if (videoRef.current) {
      videoRef.current.currentTime = value;
      setCurrentTime(value);
    }
  };

  const goToNextText = useCallback(() => {
    const currentIndex = sortedFiles.text.indexOf(currentTextFile);
    if (currentIndex === -1 || currentIndex === sortedFiles.text.length - 1) {
      setCurrentTextFile(sortedFiles.text[0]);
    } else {
      setCurrentTextFile(sortedFiles.text[currentIndex + 1]);
    }
    setCurrentPage(0);
  }, [currentTextFile, sortedFiles.text]);

  const goToPreviousText = useCallback(() => {
    const currentIndex = sortedFiles.text.indexOf(currentTextFile);
    if (currentIndex <= 0) {
      setCurrentTextFile(sortedFiles.text[sortedFiles.text.length - 1]);
    } else {
      setCurrentTextFile(sortedFiles.text[currentIndex - 1]);
    }
    setCurrentPage(0);
  }, [currentTextFile, sortedFiles.text]);

  const goToNextMedia = useCallback(() => {
    const currentIndex = sortedFiles.media.indexOf(currentMediaFile);
    if (currentIndex === -1 || currentIndex === sortedFiles.media.length - 1) {
      setCurrentMediaFile(sortedFiles.media[0]);
    } else {
      setCurrentMediaFile(sortedFiles.media[currentIndex + 1]);
    }
    setIsPlaying(false);
  }, [currentMediaFile, sortedFiles.media]);

  const goToPreviousMedia = useCallback(() => {
    const currentIndex = sortedFiles.media.indexOf(currentMediaFile);
    if (currentIndex <= 0) {
      setCurrentMediaFile(sortedFiles.media[sortedFiles.media.length - 1]);
    } else {
      setCurrentMediaFile(sortedFiles.media[currentIndex - 1]);
    }
    setIsPlaying(false);
  }, [currentMediaFile, sortedFiles.media]);

  const handleKeyPress = useCallback((event) => {
    if (Object.keys(files).length === 0) return;
    
    switch(event.key) {
      case 'ArrowRight':
        event.preventDefault();
        goToNextText();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        goToPreviousText();
        break;
      case 'ArrowDown':
        event.preventDefault();
        goToNextMedia();
        break;
      case 'ArrowUp':
        event.preventDefault();
        goToPreviousMedia();
        break;
      case ' ':  // Spacebar
        event.preventDefault();  // Prevent page scroll
        if (files[currentMediaFile]?.type === 'video') {
          togglePlay();
        }
        break;
      default:
        break;
    }
  }, [files, goToNextText, goToPreviousText, goToNextMedia, goToPreviousMedia, currentMediaFile, togglePlay]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [handleKeyPress]);

  // Speak text using OpenAI TTS API
  const speakWithOpenAI = useCallback(async (text, { onEnd, onError } = {}) => {
    const apiKey = localStorage.getItem('OPENAI_API_KEY') || '';
    if (!apiKey) {
      console.warn('OPENAI_API_KEY not found in localStorage');
      if (onError) onError(new Error('No API key'));
      return;
    }
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    try {
      setIsSpeaking(true);
      const resp = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({ model: 'tts-1', input: text, voice: openaiVoiceRef.current, speed: 1.0 })
      });
      if (!resp.ok) {
        console.error('OpenAI TTS error:', resp.status, await resp.text());
        setIsSpeaking(false);
        if (onError) onError(new Error('OpenAI error ' + resp.status));
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        currentAudioRef.current = null;
        setIsSpeaking(false);
        if (onEnd) onEnd();
      };
      audio.onerror = (e) => {
        URL.revokeObjectURL(url);
        currentAudioRef.current = null;
        setIsSpeaking(false);
        if (onError) onError(e);
      };
      audio.play();
    } catch (err) {
      console.error('OpenAI TTS fetch error:', err);
      setIsSpeaking(false);
      if (onError) onError(err);
    }
  }, []);

  // Auto-speak the next file after advancing
  useEffect(() => {
    if (speakAfterAdvance && currentTextFile && files[currentTextFile]) {
      setSpeakAfterAdvance(false);
      const text = files[currentTextFile].content;
      const handleEnd = () => {
        setIsSpeaking(false);
        if (autoAdvanceRef.current) {
          goToNextText();
          setSpeakAfterAdvance(true);
        }
      };

      if (ttsEngineRef.current === 'openai') {
        speakWithOpenAI(text, { onEnd: handleEnd, onError: () => setIsSpeaking(false) });
      } else {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = /[\u4e00-\u9fff]/.test(text) ? 'zh-HK' : 'en-US';
        utterance.onstart = () => setIsSpeaking(true);
        utterance.onend = handleEnd;
        utterance.onerror = () => setIsSpeaking(false);
        speechSynthesis.speak(utterance);
      }
    }
  }, [speakAfterAdvance, currentTextFile, files, goToNextText, speakWithOpenAI]);

  const speakText = () => {
    if (!currentTextFile || !files[currentTextFile]) return;

    if (isSpeaking) {
      speechSynthesis.cancel();
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }
      setIsSpeaking(false);
      return;
    }

    const text = files[currentTextFile].content;
    const handleEnd = () => {
      setIsSpeaking(false);
      if (autoAdvanceRef.current) {
        goToNextText();
        setSpeakAfterAdvance(true);
      }
    };

    // === OpenAI TTS ===
    if (ttsEngineRef.current === 'openai') {
      speakWithOpenAI(text, { onEnd: handleEnd, onError: (e) => { console.log('TTS Error:', e); setIsSpeaking(false); } });
      return;
    }

    // === Browser TTS ===
    const utterance = new SpeechSynthesisUtterance(text);

    const hasChinese = /[\u4e00-\u9fff]/.test(text);
    if (hasChinese) {
      const voices = speechSynthesis.getVoices();
      const chineseVoice = voices.find(voice =>
        voice.lang.includes('zh') ||
        voice.lang.includes('cmn') ||
        voice.name.toLowerCase().includes('chinese') ||
        voice.name.toLowerCase().includes('mandarin') ||
        voice.name.toLowerCase().includes('cantonese')
      );

      if (chineseVoice) {
        utterance.voice = chineseVoice;
        utterance.lang = chineseVoice.lang;
      } else {
        utterance.lang = 'zh-HK';
      }
    } else {
      utterance.lang = 'en-US';
    }

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = handleEnd;
    utterance.onerror = (e) => {
      console.log('TTS Error:', e);
      setIsSpeaking(false);
    };

    speechSynthesis.speak(utterance);
  };

  const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className="h-screen flex flex-col">
      <div className="flex items-center justify-end p-1 gap-2 text-xs text-gray-500">
        <span className="text-[10px]">←→ text | ↑↓ media | space play</span>
        <label className="cursor-pointer hover:bg-gray-100 p-1 rounded-full">
          <Upload className="w-5 h-5 text-gray-500" />
          <input 
            type="file" 
            accept=".txt,.png,.jpg,.jpeg,.mp4"
            multiple
            className="hidden"
            onChange={handleFileUpload}
          />
          />
        </label>
      </div>

      <div className="flex-1 flex gap-4 px-4 pb-4 min-h-0">
        <Card className="flex-1 flex flex-col">
          <CardHeader className="py-2">
            <CardTitle className="text-sm flex justify-between items-center">
              Text Files
              <span className="text-xs text-gray-500">{sortedFiles.text.length} files</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col min-h-0 p-2">
            {sortedFiles.text.length > 0 ? (
              <>
                <div className="mb-2 flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={goToPreviousText}
                    disabled={!currentTextFile || sortedFiles.text.indexOf(currentTextFile) === 0}
                    size="icon"
                    className="h-8 w-8"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                  
                  <select 
                    value={currentTextFile}
                    onChange={(e) => {
                      setCurrentTextFile(e.target.value);
                      setCurrentPage(0);
                    }}
                    className="flex-grow p-1 text-sm border rounded-md"
                  >
                    {sortedFiles.text.map(fileName => (
                      <option key={fileName} value={fileName}>{fileName}</option>
                    ))}
                  </select>

                  <Button
                    variant="outline"
                    onClick={goToNextText}
                    disabled={!currentTextFile || sortedFiles.text.indexOf(currentTextFile) === sortedFiles.text.length - 1}
                    size="icon"
                    className="h-8 w-8"
                  >
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                  
                  <Button
                    variant={isSpeaking ? "default" : "outline"}
                    onClick={speakText}
                    disabled={!currentTextFile}
                    size="icon"
                    className="h-8 w-8"
                  >
                    <Speaker className="w-4 h-4" />
                  </Button>

                  {/* TTS Engine Toggle */}
                  <button
                    onClick={() => {
                      const next = ttsEngine === 'browser' ? 'openai' : 'browser';
                      setTtsEngine(next);
                      localStorage.setItem('mediaTtsEngine', next);
                    }}
                    className={`px-2 py-1 rounded text-xs font-semibold ${
                      ttsEngine === 'openai' ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                    }`}
                    title={ttsEngine === 'openai' ? 'Using OpenAI TTS (click for browser)' : 'Using browser TTS (click for OpenAI)'}
                  >
                    {ttsEngine === 'openai' ? 'AI' : 'TTS'}
                  </button>

                  {/* OpenAI voice + key - only when OpenAI active */}
                  {ttsEngine === 'openai' && (
                    <>
                      <select
                        value={openaiVoice}
                        onChange={(e) => { setOpenaiVoice(e.target.value); localStorage.setItem('mediaOpenaiVoice', e.target.value); }}
                        className="px-1 py-1 rounded text-xs border border-green-400 bg-green-50 text-green-800"
                        title="Select OpenAI voice"
                      >
                        <option value="onyx">Onyx</option>
                        <option value="nova">Nova</option>
                        <option value="alloy">Alloy</option>
                        <option value="echo">Echo</option>
                        <option value="fable">Fable</option>
                        <option value="shimmer">Shimmer</option>
                      </select>
                      <button
                        onClick={() => setShowApiKeyInput(!showApiKeyInput)}
                        className={`px-1.5 py-1 rounded text-xs font-semibold ${
                          localStorage.getItem('OPENAI_API_KEY') ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-red-100 text-red-700 hover:bg-red-200'
                        }`}
                        title={localStorage.getItem('OPENAI_API_KEY') ? 'API key set — click to change' : 'No API key — click to enter'}
                      >
                        Key
                      </button>
                      {showApiKeyInput && (
                        <input
                          type="text"
                          placeholder="sk-..."
                          value={apiKeyValue}
                          onFocus={() => { if (apiKeyValue.startsWith('••••')) setApiKeyValue(''); }}
                          onChange={(e) => setApiKeyValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && apiKeyValue && !apiKeyValue.startsWith('••••')) {
                              localStorage.setItem('OPENAI_API_KEY', apiKeyValue);
                              setApiKeyValue('••••' + apiKeyValue.slice(-4));
                              setShowApiKeyInput(false);
                            }
                          }}
                          onBlur={() => {
                            if (apiKeyValue && !apiKeyValue.startsWith('••••')) {
                              localStorage.setItem('OPENAI_API_KEY', apiKeyValue);
                              setApiKeyValue('••••' + apiKeyValue.slice(-4));
                            }
                          }}
                          className="px-1.5 py-1 rounded text-xs border border-green-400 bg-white text-gray-800 w-36"
                          title="Paste OpenAI API key and press Enter"
                        />
                      )}
                    </>
                  )}

                  <label className="flex items-center gap-1 cursor-pointer ml-2" title="Auto-advance to next file after reading">
                    <input
                      type="checkbox"
                      checked={autoAdvance}
                      onChange={(e) => setAutoAdvance(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="relative w-9 h-5 bg-gray-300 peer-checked:bg-green-500 rounded-full transition-colors">
                      <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${autoAdvance ? 'translate-x-4' : ''}`} />
                    </div>
                    <span className="text-[10px] text-gray-500">{autoAdvance ? 'Auto' : 'Stop'}</span>
                  </label>
                </div>

                {currentTextFile && (
                  <div className="prose max-w-none whitespace-pre-wrap overflow-y-auto flex-1" style={{fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", SimSun'}}>
                    {files[currentTextFile].content}
                  </div>
                )}
              </>
            ) : (
              <div className="text-center text-gray-500 text-sm">No text files uploaded</div>
            )}
          </CardContent>
        </Card>

        <Card className="flex-1 flex flex-col">
          <CardHeader className="py-2">
            <CardTitle className="text-sm flex justify-between items-center">
              Media Files
              <span className="text-xs text-gray-500">{sortedFiles.media.length} files</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col min-h-0 p-2">
            {sortedFiles.media.length > 0 ? (
              <>
                <div className="mb-2 flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={goToPreviousMedia}
                    disabled={!currentMediaFile || sortedFiles.media.indexOf(currentMediaFile) === 0}
                    size="icon"
                    className="h-8 w-8"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                  
                  <select 
                    value={currentMediaFile}
                    onChange={(e) => {
                      setCurrentMediaFile(e.target.value);
                      setIsPlaying(false);
                    }}
                    className="flex-grow p-1 text-sm border rounded-md"
                  >
                    {sortedFiles.media.map(fileName => (
                      <option key={fileName} value={fileName}>{fileName}</option>
                    ))}
                  </select>

                  <Button
                    variant="outline"
                    onClick={goToNextMedia}
                    disabled={!currentMediaFile || sortedFiles.media.indexOf(currentMediaFile) === sortedFiles.media.length - 1}
                    size="icon"
                    className="h-8 w-8"
                  >
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </div>

                {currentMediaFile && (
                  <div className="flex-1 flex flex-col">
                    <div className="flex-1 flex items-center justify-center overflow-hidden">
                      {files[currentMediaFile].type === 'image' ? (
                        <img 
                          src={files[currentMediaFile].content[0]} 
                          alt={currentMediaFile}
                          className="max-w-full max-h-full object-contain"
                        />
                      ) : (
                        <video
                          ref={videoRef}
                          src={files[currentMediaFile].content[0]}
                          className="max-w-full max-h-full"
                          onTimeUpdate={handleVideoTimeUpdate}
                          onDurationChange={handleVideoDurationChange}
                          onEnded={handleVideoEnded}
                        />
                      )}
                    </div>
                    
                    {files[currentMediaFile]?.type === 'video' && (
                      <div className="mt-2 flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={togglePlay}
                          >
                            {isPlaying ? (
                              <Pause className="w-4 h-4" />
                            ) : (
                              <Play className="w-4 h-4" />
                            )}
                          </Button>
                          <div className="flex-1">
                            <Slider
                              value={[currentTime]}
                              max={duration}
                              step={0.1}
                              onValueChange={(value) => handleSeek(value[0])}
                            />
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={toggleMute}
                          >
                            {isMuted ? (
                              <VolumeX className="w-4 h-4" />
                            ) : (
                              <Volume2 className="w-4 h-4" />
                            )}
                          </Button>
                        </div>
                        <div className="text-xs text-gray-500 text-center">
                          {formatTime(currentTime)} / {formatTime(duration)}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="text-center text-gray-500 text-sm">No media files uploaded</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default MediaReader;