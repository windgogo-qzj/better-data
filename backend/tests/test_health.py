from better_data.main import health


def test_health_reports_offline_service() -> None:
    response = health()

    assert response.model_dump() == {"status": "ok", "version": "0.1.0", "offline": True}
