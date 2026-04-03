import { StrictMode, useState, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import './i18n'
import App from './App.tsx'
import { SplashScreen } from './components/shared/SplashScreen.tsx'

function Root() {
  const alreadyLoaded = sessionStorage.getItem('df-loaded') === '1';
  const [showSplash, setShowSplash] = useState(!alreadyLoaded);

  const handleSplashFinished = useCallback(() => {
    setShowSplash(false);
  }, []);

  return (
    <>
      <App />
      {showSplash && <SplashScreen onFinished={handleSplashFinished} />}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
