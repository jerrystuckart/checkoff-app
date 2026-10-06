// React Navigation linking configuration, extracted from App.jsx so tests can run the real config through
// getStateFromPath. App.jsx wraps getStateFromPath with normalizeLinkPath (see lib/emailLinkContract.js), which
// rewrites every accepted URL form into the single form matched below.
export const LINK_PREFIXES = [
  'checkoff://',
  'https://getcheckoff.com',
  'https://www.getcheckoff.com',
]

export const LINKING_CONFIG = {
  screens: {
    HomeTab: {
      screens: {
        JoinList: 'join/:invite_code',
        CuratedListPreview: 'next10',
        DeepLinkListResolver: {
          path: 'list',
          parse: {
            id: (id) => id,
          },
        },
        DeepLinkExperienceResolver: {
          path: 'experience',
          parse: {
            tag: (tag) => tag,
          },
        },
        DeepLinkItemResolver: {
          path: 'item/:id',
          parse: {
            id: (id) => id,
          },
        },
        DeepLinkMetroResolver: {
          path: 'metro',
          parse: {
            slug: (slug) => slug,
            id: (id) => id,
          },
        },
        // Destination Hub: checkoff://destination/<destinations.id> (printed Willcox QR landing page).
        Hub: 'destination/:destinationId',
        DeepLinkCreatorResolver: {
          path: 'c/:handle',
          parse: {
            handle: (h) => h,
          },
        },
        ResetPassword: {
          path: 'reset-password',
          parse: {
            access_token: (v) => v,
            refresh_token: (v) => v,
            token: (v) => v,
            type: (v) => v,
          },
        },
        ConfirmEmail: {
          path: 'auth/confirm',
          parse: {
            access_token: (v) => v,
            refresh_token: (v) => v,
            token: (v) => v,
            type: (v) => v,
            code: (v) => v,
          },
        },
        Home: '',
      },
    },
  },
}
