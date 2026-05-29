import Link from "next/link";
import styles from "./landing.module.css";

export default function Landing() {
  return (
    <div className={styles.wrap}>
      <main className={styles.card}>
        <h1 className={styles.title}>Palate</h1>
        <p className={styles.tagline}>
          A pocket recipe book. Cooking, cocktails, everything you&apos;ve collected
          over the years - searchable, editable, and never lost.
        </p>
        <ul className={styles.features}>
          <li>Browse hundreds of recipes by ingredient or vibe.</li>
          <li>AI-assisted meal ideas when you don&apos;t know what to make.</li>
          <li>Admins can edit, generate instructions, and manage approved users.</li>
        </ul>
        <div className={styles.actions}>
          <Link href="/login" className={`${styles.btn} ${styles.btnPrimary}`}>
            Sign in
          </Link>
          <Link href="/signup" className={`${styles.btn} ${styles.btnSecondary}`}>
            Request an account
          </Link>
        </div>
        <p className={styles.note}>
          New accounts are reviewed by an admin before they can sign in.
        </p>
      </main>
    </div>
  );
}
