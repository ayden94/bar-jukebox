import type {
  ReactNavigationFailurePolicy,
  ReactSessionPolicy,
} from "@fluojs/react/client";

export const adminNavigationFailurePolicy: ReactNavigationFailurePolicy = ({
  reason,
}) => {
  switch (reason) {
    case "network":
    case "server-error":
    case "import-failure":
    case "incompatible-build":
      return "preserve";
    default:
      return "document";
  }
};

export const adminSessionPolicy: ReactSessionPolicy = ({ reason }) => {
  switch (reason) {
    case "login":
      return "refresh";
    case "permissions":
    case "forbidden":
      return "forbidden";
    default:
      return "signed-out";
  }
};
