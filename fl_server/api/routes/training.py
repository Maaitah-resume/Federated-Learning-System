# Add these imports at the top:
from core.data_engineer import analyze_csv
from core.schema_store import schema_store
from core.local_trainer import train_local
import base64

# REPLACE the /fl/initialize endpoint with this version:
@router.post("/initialize")
def initialize(req: dict):
    """
    Smart initialize: if first participant's CSV is provided, auto-detects schema.
    Otherwise uses default schema (assumes 25 features).
    """
    job_id        = req.get('job_id')
    model_version = req.get('model_version', 'IDSNet_v2')
    sample_csv_b64 = req.get('sample_csv_b64')  # NEW: optional CSV for schema detection

    if not job_id:
        raise HTTPException(status_code=400, detail='job_id required')

    # Auto-detect schema from sample CSV if provided
    if sample_csv_b64:
        try:
            csv_bytes = base64.b64decode(sample_csv_b64.encode())
            schema    = analyze_csv(csv_bytes)
            schema_store.set(job_id, schema)
            print(f"[Initialize] Schema detected: {schema['input_dim']} features, "
                  f"target='{schema['target_col']}', "
                  f"binary={schema['is_binary']}, "
                  f"classes={schema['target_unique']}")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f'Schema analysis failed: {e}')
    else:
        # Default schema (25 features, binary)
        schema = {'input_dim': 25, 'output_dim': 1, 'is_binary': True}
        schema_store.set(job_id, schema)

    # Build model with detected dimensions
    from models.ids_model import build_model
    from core.model_manager import serialize_weights, count_parameters

    model      = build_model(input_dim=schema['input_dim'], output_dim=schema['output_dim'])
    state_dict = model.state_dict()

    round_controller._jobs[job_id] = {
        'state_dict':    state_dict,
        'model_version': model_version,
        'current_round': 0,
    }

    return {
        'weights_b64':        serialize_weights(state_dict),
        'model_architecture': model_version,
        'num_params':         count_parameters(model),
        'schema':             {
            'input_dim':  schema['input_dim'],
            'output_dim': schema['output_dim'],
            'is_binary':  schema['is_binary'],
            'target_col': schema.get('target_col'),
            'features':   schema.get('numerical_cols', []) + schema.get('categorical_cols', []),
        },
    }


# REPLACE the /fl/train-local endpoint:
@router.post("/train-local")
def train_local_endpoint(req: dict):
    job_id             = req.get('job_id')
    company_id         = req.get('company_id')
    round_num          = req.get('round', 1)
    global_weights_b64 = req.get('global_weights_b64')
    csv_data_b64       = req.get('csv_data_b64')
    epochs             = req.get('epochs', 3)

    if not all([job_id, company_id, global_weights_b64, csv_data_b64]):
        raise HTTPException(status_code=400, detail='Missing required fields')

    # Get the job's schema (must have been set by /fl/initialize)
    schema = schema_store.get(job_id)
    if not schema:
        raise HTTPException(status_code=400, detail=f'No schema for job {job_id}. Call /fl/initialize first.')

    try:
        csv_bytes = base64.b64decode(csv_data_b64.encode())
        result    = train_local(global_weights_b64, csv_bytes, schema, epochs=epochs)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Local training failed: {str(e)}')

    state_dict = deserialize_weights(result['weights_b64'])
    weight_store.store(
        job_id=job_id,
        round_number=round_num,
        company_id=company_id,
        weights=state_dict,
        dataset_size=result['dataset_size'],
        validation_loss=result['metrics']['validation_loss'],
    )

    return {
        'trained':      True,
        'company_id':   company_id,
        'dataset_size': result['dataset_size'],
        'metrics':      result['metrics'],
    }
