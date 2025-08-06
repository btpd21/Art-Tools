#!/bin/bash
set -e

PATCH_DIR="./"
COLLAGE_FILE="collage.js"

case $1 in
  apply)
    if [ -z "$2" ]; then
      echo "⚠️ Please specify the patch file to apply."
      exit 1
    fi
    echo "✅ Applying patch: $2"
    git apply "$PATCH_DIR/$2"
    ;;
  revert)
    if [ -z "$2" ]; then
      echo "⚠️ Please specify the patch file to revert."
      exit 1
    fi
    echo "↩️ Reverting patch: $2"
    git apply -R "$PATCH_DIR/$2"
    ;;
  list)
    echo "📜 Available patch files:"
    ls $PATCH_DIR/*.patch 2>/dev/null || echo "No patch files found."
    ;;
  *)
    echo "Usage:"
    echo "  ./manage-patches.sh apply <patch-file.patch>"
    echo "  ./manage-patches.sh revert <patch-file.patch>"
    echo "  ./manage-patches.sh list"
    ;;
esac