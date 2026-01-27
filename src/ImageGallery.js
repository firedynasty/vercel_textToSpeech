import React, { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Upload } from 'lucide-react';
import { Button } from './components/ui/button';
import { Card, CardContent } from './components/ui/card';

const ImageGallery = () => {
  const [images, setImages] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [filepaths, setFilepaths] = useState('');

  const handleFileSelect = (event) => {
    const files = Array.from(event.target.files);
    const imageUrls = files.map(file => URL.createObjectURL(file));
    setImages(imageUrls);
    setCurrentIndex(0);
  };

  const handleFilepathsLoad = () => {
    if (!filepaths.trim()) return;
    
    const paths = filepaths.split(',').map(path => path.trim()).filter(path => path);
    const imageUrls = paths.map(path => {
      // Handle relative paths by prepending with images folder
      if (!path.startsWith('http') && !path.startsWith('/')) {
        return `/images/${path}`;
      }
      return path;
    });
    
    setImages(imageUrls);
    setCurrentIndex(0);
  };

  const goToPrevious = useCallback(() => {
    setCurrentIndex((prevIndex) => 
      prevIndex === 0 ? images.length - 1 : prevIndex - 1
    );
  }, [images.length]);

  const goToNext = useCallback(() => {
    setCurrentIndex((prevIndex) => 
      prevIndex === images.length - 1 ? 0 : prevIndex + 1
    );
  }, [images.length]);

  useEffect(() => {
    const handleKeyPress = (event) => {
      if (images.length === 0) return;
      
      switch(event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          goToPrevious();
          break;
        case 'ArrowRight':
          event.preventDefault();
          goToNext();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [images.length, goToNext, goToPrevious]);

  if (images.length === 0) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Card className="p-8 w-96">
          <CardContent className="text-center space-y-4">
            <p className="text-gray-500">No images selected</p>
            
            <div className="space-y-3">
              <label className="cursor-pointer">
                <Button variant="outline" asChild>
                  <span>
                    <Upload className="w-4 h-4 mr-2" />
                    Choose Images
                  </span>
                </Button>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleFileSelect}
                />
              </label>
              
              <div className="text-sm text-gray-400">or</div>
              
              <div className="space-y-2">
                <textarea
                  value={filepaths}
                  onChange={(e) => setFilepaths(e.target.value)}
                  placeholder="Enter image paths separated by commas&#10;e.g. image1.png, image2.png, Screenshot 2025-05-18 at 11.58.35 AM.png"
                  className="w-full h-20 p-2 border rounded-md text-sm resize-none"
                  rows={3}
                />
                <Button 
                  onClick={handleFilepathsLoad}
                  disabled={!filepaths.trim()}
                  className="w-full"
                >
                  Load Images from Paths
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <div className="flex items-center justify-between p-4">
        <div className="text-sm text-gray-600">
          Image {currentIndex + 1} of {images.length}
        </div>
        <div className="flex items-center gap-4">
          <div className="text-xs text-gray-500">
            ←→ navigate
          </div>
          <label className="cursor-pointer">
            <Button variant="outline" size="sm" asChild>
              <span>
                <Upload className="w-4 h-4 mr-2" />
                Choose Images
              </span>
            </Button>
            <input
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileSelect}
            />
          </label>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center px-4 pb-4">
        <div className="relative max-w-full max-h-full flex items-center">
          <Button
            variant="outline"
            size="icon"
            className="absolute left-4 z-10 bg-white/80 hover:bg-white"
            onClick={goToPrevious}
            disabled={images.length <= 1}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>

          <div className="mx-16">
            <img
              src={images[currentIndex]}
              alt={`Gallery item ${currentIndex + 1}`}
              className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-lg"
              onError={(e) => {
                e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="%23f3f4f6"/><text x="200" y="150" text-anchor="middle" font-family="Arial" font-size="16" fill="%236b7280">Image not found</text></svg>';
              }}
            />
          </div>

          <Button
            variant="outline"
            size="icon"
            className="absolute right-4 z-10 bg-white/80 hover:bg-white"
            onClick={goToNext}
            disabled={images.length <= 1}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="p-4 text-center">
        <div className="flex justify-center space-x-2">
          {images.map((_, index) => (
            <button
              key={index}
              className={`w-2 h-2 rounded-full transition-colors ${
                index === currentIndex ? 'bg-blue-500' : 'bg-gray-300'
              }`}
              onClick={() => setCurrentIndex(index)}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default ImageGallery;