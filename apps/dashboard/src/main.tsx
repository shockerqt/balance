import "@workspace/ui/globals.css";
import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { GlobalContext } from "./config/global-context";
import { RouterConfig } from "./config/router";
import reportWebVitals from "./reportWebVitals";

const rootElement = document.getElementById("app");
if (rootElement && !rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <StrictMode>
      <GlobalContext>
        <RouterConfig />
      </GlobalContext>
    </StrictMode>,
  );
}

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
