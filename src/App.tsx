import { useState } from "react";
import { Footer } from "./components/Footer";
import { Glossary } from "./components/Glossary";
import { Hero } from "./components/Hero";
import { Masthead } from "./components/Masthead";
import { Pond } from "./components/Pond";
import { Quiz } from "./components/Quiz";
import { Stage } from "./components/Stage";
import type { VarietyId } from "./lib/varieties";
import "./components/sections.css";

export default function App() {
  const [variety, setVariety] = useState<VarietyId>("kohaku");

  return (
    <>
      <a className="skip-link" href="#varieties">
        Skip to the guide
      </a>
      <Masthead />
      <main>
        <Hero />
        <Stage selected={variety} onSelect={setVariety} />
        <Glossary onShowVariety={setVariety} />
        <Quiz />
        <Pond />
      </main>
      <Footer />
    </>
  );
}
