# Terraform state bootstrap

環境別のTerraform stateを保存するS3バケットを一度だけ作成する。
このbootstrap構成自身のstateはローカルに作られるため、安全な場所へ保管する。

```bash
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform plan
terraform apply
```

`state_bucket_name` は全世界で一意にする。作成後は
`../environments/dev/backend.hcl` の `bucket` に同じ値を設定する。

stateバケットには `prevent_destroy` が設定されている。削除が必要な場合も、
stateの退避と参照環境の確認を行わずに設定を外さない。
