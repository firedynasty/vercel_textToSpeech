#!/bin/bash
# Script to list image files in ./public/images folder as comma-separated values
# Usage: ./list-images.sh [filter]
# Example: ./list-images.sh icon (finds files containing "icon")

# Check if filter argument provided
filter="$1"

# if you want to build and access within this folder
# it's find . -maxdepth 1 , etc

# Build find command based on whether filter is provided
if [ -n "$filter" ]; then
    # With filter - add wildcards before and after the argument
    images=$(find ./public/images -maxdepth 1 -type f \( -iname "*${filter}*.png" -o -iname "*${filter}*.jpg" -o -iname "*${filter}*.jpeg" -o -iname "*${filter}*.gif" -o -iname "*${filter}*.bmp" -o -iname "*${filter}*.webp" \) | sed 's|^\./public/images/||' | sort)
else
    # Without filter - get all image files
    images=$(find ./public/images -maxdepth 1 -type f \( -iname "*.png" -o -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.gif" -o -iname "*.bmp" -o -iname "*.webp" \) | sed 's|^\./public/images/||' | sort)
fi

# Check if any images found
if [ -z "$images" ]; then
    if [ -n "$filter" ]; then
        echo "No image files found in ./public/images directory matching filter: $filter"
    else
        echo "No image files found in ./public/images directory"
    fi
    exit 1
fi

# Convert to comma-separated list
comma_separated=$(echo "$images" | tr '\n' ',' | sed 's/,$//')

echo "Found images:"
echo "$images"
echo ""
echo "Comma-separated list (copy this to textarea):"
echo "$comma_separated"

if [ -n "$filter" ]; then
    echo ""
    echo "Filter applied: *${filter}*"
fi

# Copy to clipboard if pbcopy is available (macOS)
if command -v pbcopy >/dev/null 2>&1; then
    echo "$comma_separated" | pbcopy
    echo ""
    echo "✓ Copied to clipboard!"
elif command -v xclip >/dev/null 2>&1; then
    # Linux alternative
    echo "$comma_separated" | xclip -selection clipboard
    echo ""
    echo "✓ Copied to clipboard!"
elif command -v clip >/dev/null 2>&1; then
    # Windows WSL alternative
    echo "$comma_separated" | clip
    echo ""
    echo "✓ Copied to clipboard!"
fi