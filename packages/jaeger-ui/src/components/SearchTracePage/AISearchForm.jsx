import * as React from 'react';
import { Input, Button, Form, Typography, Select } from 'antd';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { bindActionCreators } from 'redux';
import store from 'store';
import SearchableSelect from '../common/SearchableSelect';
import * as jaegerApiActions from '../../actions/jaeger-api';
import { DEFAULT_LIMIT } from '../../constants/search-form';
import { submitForm } from './SearchForm';
import './AISearchForm.css';
import { aiTranslationService } from '../../services/AITranslationService';

const { Text } = Typography;

const EXAMPLE_QUERIES = [
  'show me errors from the last hour',
  'find slow requests taking more than 5s',
  'show failed payment transactions from yesterday',
];

export class AISearchFormImpl extends React.PureComponent {
  constructor(props) {
    super(props);
    // Get last used service
    const lastSearch = store.get('lastSearch');
    let lastSearchService;
    if (lastSearch && lastSearch.service && lastSearch.service !== '-') {
      if (props.services.some(s => s.name === lastSearch.service)) {
        lastSearchService = lastSearch.service;
      }
    }

    this.state = {
      query: '',
      selectedService: lastSearchService,
      isTranslating: false,
      translatedQuery: null,
      error: null,
    };
  }

  handleQueryChange = (e) => {
    this.setState({ query: e.target.value });
  };

  handleServiceChange = (value) => {
    this.setState({ selectedService: value });
  };

  handleExampleClick = (example) => {
    this.setState({ query: example });
  };

  handleSubmit = async (e) => {
    e.preventDefault();
    const { query, selectedService } = this.state;
    
    this.setState({ isTranslating: true });
    
    try {
      const translatedQuery = await aiTranslationService.translateQuery(query, {
        selectedService,
      });

      translatedQuery.service = selectedService;

      this.setState({ 
        isTranslating: false,
        translatedQuery,
        error: null
      });
      this.props.submitFormHandler(translatedQuery);
    } catch (error) {
      this.setState({ 
        isTranslating: false,
        error: error.message 
      });
    }
  };

  render() {
    const { query, selectedService, isTranslating, translatedQuery, error } = this.state;
    const { submitting, services } = this.props;
    const noSelectedService = !selectedService;

    return (
      <div className="AISearchForm">
        <Form layout="vertical" onSubmitCapture={this.handleSubmit}>
          <Form.Item
            label={
              <span>
                Service <span className="SearchForm--labelCount">({services.length})</span>
              </span>
            }
            required
          >
            <SearchableSelect
              value={selectedService}
              onChange={this.handleServiceChange}
              placeholder="Select a service"
              style={{ width: '100%' }}
              disabled={submitting || isTranslating}
            >
              {services.map(service => (
                <Select.Option key={service.name} value={service.name}>
                  {service.name}
                </Select.Option>
              ))}
            </SearchableSelect>
          </Form.Item>

          <Form.Item
            label={
              <span>
                Natural Language Query
                <Text type="secondary" style={{ marginLeft: 8 }}>
                  (describe what you're looking for)
                </Text>
              </span>
            }
          >
            <Input.TextArea
              value={query}
              onChange={this.handleQueryChange}
              placeholder="Describe what you're looking for..."
              disabled={submitting || isTranslating}
              autoSize={{ minRows: 2, maxRows: 6 }}
              style={{ marginBottom: '16px' }}
            />
          </Form.Item>

          <div className="AISearchForm--examples">
            <Text>Examples: </Text>
            {EXAMPLE_QUERIES.map((example) => (
              <Text
                key={example}
                className="AISearchForm--example"
                onClick={() => this.handleExampleClick(example)}
              >
                {example}
              </Text>
            ))}
          </div>

          {translatedQuery && (
            <div className="AISearchForm--translatedQuery">
              <Form.Item label="Translated Query">
                <pre style={{ background: '#f5f5f5', padding: '8px', borderRadius: '4px' }}>
                  {JSON.stringify(translatedQuery, null, 2)}
                </pre>
              </Form.Item>
            </div>
          )}

          {error && (
            <div className="AISearchForm--error">
              <Form.Item label="Error">
                <Text type="danger">{error}</Text>
              </Form.Item>
            </div>
          )}

          <Button
            type="primary"
            htmlType="submit"
            loading={submitting || isTranslating}
            disabled={!query.trim() || noSelectedService}
            data-test="ai-search-submit"
          >
            Search Traces
          </Button>
        </Form>
      </div>
    );
  }
}

AISearchFormImpl.propTypes = {
  submitting: PropTypes.bool,
  submitFormHandler: PropTypes.func.isRequired,
  services: PropTypes.arrayOf(
    PropTypes.shape({
      name: PropTypes.string,
      operations: PropTypes.arrayOf(PropTypes.string),
    })
  ).isRequired,
};

AISearchFormImpl.defaultProps = {
  submitting: false,
};

export function mapDispatchToProps(dispatch) {
  const { searchTraces } = bindActionCreators(jaegerApiActions, dispatch);
  return {
    submitFormHandler: fields => submitForm(fields, searchTraces),
  };
}

export function mapStateToProps(state) {
  const services = state.services.services || [];
  return {
    services: services.map(name => ({ name }))
  };
}

export default connect(
  mapStateToProps,
  mapDispatchToProps
)(AISearchFormImpl); 