import { Route, Routes } from 'react-router'
import { BookScreen } from './screens/BookScreen.tsx'
import { HomeScreen } from './screens/HomeScreen.tsx'
import { NotFoundScreen } from './screens/NotFoundScreen.tsx'
import { OrderScreen } from './screens/OrderScreen.tsx'
import { PreviewScreen } from './screens/PreviewScreen.tsx'
import { PrintScreen } from './screens/PrintScreen.tsx'
import { TemplateScreen } from './screens/TemplateScreen.tsx'
import { TextsScreen } from './screens/TextsScreen.tsx'

// Карта адресов сайта.
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeScreen />} />
      <Route path="/templates/:id" element={<TemplateScreen />} />
      <Route path="/b/:token" element={<BookScreen />} />
      <Route path="/b/:token/preview" element={<PreviewScreen />} />
      <Route path="/b/:token/order" element={<OrderScreen />} />
      <Route path="/b/:token/texts" element={<TextsScreen />} />
      <Route path="/print/:orderId" element={<PrintScreen />} />
      <Route path="*" element={<NotFoundScreen />} />
    </Routes>
  )
}
