import Head from 'next/head'
import '../global.css'

export default function MyApp({ Component, pageProps }) {
  return (
    <>
      <Head>
        <link rel="icon" type="image/png" href="/nova-logo.png" />
        <link rel="apple-touch-icon" href="/nova-logo.png" />
      </Head>
      <Component {...pageProps} />
    </>
  )
}
