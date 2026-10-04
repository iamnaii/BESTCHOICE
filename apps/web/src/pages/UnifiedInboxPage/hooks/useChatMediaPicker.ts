import { useEffect, useState } from 'react';
import { useDebounce } from '@/hooks/useDebounce';

interface GifResult {
  id: string;
  title?: string;
  images?: { fixed_width?: { url: string }; fixed_width_small?: { url: string } };
}

/** Keep picker state mounted with the composer across popover and note-mode changes. */
export function useChatMediaPicker() {
  // picker top-level tab
  type PickerTab = 'emoji' | 'sticker' | 'gif';
  const [pickerTab, setPickerTab] = useState<PickerTab>('emoji');
  // emoji sub-tab (category index)
  const [emojiCategory, setEmojiCategory] = useState(0);
  // sticker sub-tab (package index)
  const [stickerPackage, setStickerPackage] = useState(0);

  // GIF picker state
  const [gifSearch, setGifSearch] = useState('');
  const gifSearchDebounced = useDebounce(gifSearch, 500);
  const [gifs, setGifs] = useState<GifResult[]>([]);
  const [loadingGifs, setLoadingGifs] = useState(false);

  const GIPHY_KEY = import.meta.env.VITE_GIPHY_KEY || 'dc6zaTOxFJmzC';
  const gifApiUrl = gifSearchDebounced
    ? `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_KEY}&q=${encodeURIComponent(gifSearchDebounced)}&limit=20&rating=g`
    : `https://api.giphy.com/v1/gifs/trending?api_key=${GIPHY_KEY}&limit=20&rating=g`;

  // Fetch GIFs whenever the GIF tab is active or the search query changes
  useEffect(() => {
    if (pickerTab !== 'gif') return;
    setLoadingGifs(true);
    fetch(gifApiUrl, { signal: AbortSignal.timeout(10_000) })
      .then((r) => r.json())
      .then((d) => setGifs(d.data ?? []))
      .catch(() => setGifs([]))
      .finally(() => setLoadingGifs(false));
  }, [gifApiUrl, pickerTab]);

  return {
    pickerTab,
    setPickerTab,
    emojiCategory,
    setEmojiCategory,
    stickerPackage,
    setStickerPackage,
    gifSearch,
    setGifSearch,
    gifs,
    loadingGifs,
  };
}
