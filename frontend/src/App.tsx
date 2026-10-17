import { Route, Routes } from 'react-router'
import { BookScreen } from './screens/BookScreen.tsx'
import { CatalogScreen } from './screens/CatalogScreen.tsx'
import { NotFoundScreen } from './screens/NotFoundScreen.tsx'
import { TemplateScreen } from './screens/TemplateScreen.tsx'

// Карта адресов сайта.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<CatalogScreen />} />
      <Route path="/templates/:id" element={<TemplateScreen />} />
      <Route path="/b/:token" element={<BookScreen />} />
      <Route path="*" element={<NotFoundScreen />} />
    </Routes>
  )
}
