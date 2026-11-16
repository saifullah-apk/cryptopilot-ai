import { PlaceholderPage } from '../components/layout/PlaceholderPage'

export function SettingsPage() {
  return (
    <PlaceholderPage
      eyebrow="System"
      title="Settings"
      description="Preferences, notifications and connection management."
      icon="settings"
      phaseLabel="Later phase"
      scope={[
        'Profile and preferences',
        'Theme is adjustable from the header today',
        'Exchange connection management',
        'API keys stored securely, never exposed',
      ]}
    />
  )
}

export function NotFoundPage() {
  return (
    <PlaceholderPage
      eyebrow="System"
      title="Page not found"
      description="That route does not exist in this build."
      icon="info"
      phaseLabel="404"
      scope={['Check the sidebar navigation', 'Return to the dashboard']}
    />
  )
}
