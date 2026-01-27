# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- `npm start` - Start development server on localhost:3000
- `npm run build` - Build production bundle
- `npm test` - Run tests with Jest
- `npm run eject` - Eject from Create React App (irreversible)

## Architecture Overview

This is a React application built with Create React App that implements a **MediaReader** component for viewing text and media files side by side. The application uses:

- **Tailwind CSS** with custom shadcn/ui components for styling
- **File upload and processing** - handles .txt, image (.png, .jpg, .jpeg), and video (.mp4) files
- **Dual-pane interface** - synchronized text and media file navigation
- **Keyboard navigation** - arrow keys for file switching, spacebar for video playback

### Key Components

- `src/MediaReader.js` - Main component handling file upload, state management, and rendering
- `src/components/ui/` - Reusable UI components (Button, Card, Slider) following shadcn/ui patterns
- Custom CSS variables in Tailwind config for theming consistency

### File Processing Architecture

Files are loaded into memory as data URLs and organized by type:
- Text files: read as plain text content
- Images: converted to data URLs for display
- Videos: converted to data URLs with custom video controls

Navigation between files maintains separate indices for text and media files, allowing independent browsing of each content type.

## Component Naming Convention

When creating new components, follow the existing pattern:
- Use `const ComponentName = () => {}` format
- Export as `export default ComponentName` 
- This matches the current App.js structure and README instructions

## UI Component System

The project uses a custom implementation of shadcn/ui components with:
- CSS-in-JS styling via className props
- Tailwind CSS utility classes
- Custom color variables defined in tailwind.config.js
- Lucide React icons for UI elements