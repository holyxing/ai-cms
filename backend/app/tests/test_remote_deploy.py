"""remote_deploy 单元测试"""
from app.models.deploy_server import DeployServer
from app.services.remote_deploy import resolve_remote_path


def test_resolve_remote_path_default():
    s = DeployServer(
        name="t", host="1.2.3.4", username="root", auth_type="pem",
        remote_base_path="/var/www/sites",
    )
    assert resolve_remote_path(s, "huoyinkeji") == "/var/www/sites/huoyinkeji/public/"


def test_resolve_remote_path_override_absolute():
    s = DeployServer(
        name="t", host="1.2.3.4", username="root", auth_type="pem",
        remote_base_path="/var/www/sites",
    )
    assert resolve_remote_path(s, "x", override="/data/www/mysite/") == "/data/www/mysite/"
