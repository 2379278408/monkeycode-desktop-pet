import { createRoot } from 'react-dom/client'
import { RootView } from './RootView'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <RootView search={window.location.search} />,
)
