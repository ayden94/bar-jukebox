import { Link, useNavigation } from "@fluojs/react/client";
import { admin } from "./styles";

export function NavigationFeedback() {
  const navigation = useNavigation();
  const failure = navigation.failure;
  const pending =
    navigation.status === "navigating" || navigation.status === "refreshing";
  const message =
    failure?.reason === "incompatible-build"
      ? "새 버전이 배포됐어요. 현재 화면을 유지하고 있어요. 새 버전으로 열어주세요."
      : failure?.reason === "import-failure"
        ? "화면 파일을 불러오지 못했어요. 현재 화면에서 다시 시도할 수 있어요."
        : failure
          ? "페이지를 불러오지 못했어요. 현재 화면과 연결은 유지하고 있어요."
          : pending
            ? "페이지를 불러오고 있어요."
            : "";

  return (
    <>
      <p className="sr-only" role="status">
        {message}
      </p>
      {failure && (
        <section
          aria-label="페이지 이동 오류"
          className={`${admin.panel} mb-6`}
        >
          <h2>페이지 이동을 완료하지 못했어요</h2>
          <p className={`${admin.note} !text-sm`}>{message}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            {/* 취소 가능한 새 이동으로 요청해 실패 정보가 승인 전에 소비되지 않게 해요. */}
            <Link
              className={admin.button}
              href={navigation.destination ?? failure.destination}
            >
              다시 시도
            </Link>
            <a
              className={`${admin.button} ${admin.ghost}`}
              href={navigation.destination ?? failure.destination}
            >
              {failure.reason === "incompatible-build"
                ? "새 버전으로 열기"
                : "전체 페이지로 열기"}
            </a>
          </div>
        </section>
      )}
    </>
  );
}
