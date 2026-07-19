import App from './App'
import { PetActionGallery } from './components/PetActionGallery'

export function isGalleryMode(search: string): boolean {
  return new URLSearchParams(search).get('gallery') === '1'
}

export function RootView({ search }: { search: string }) {
  return isGalleryMode(search) ? <PetActionGallery /> : <App />
}
